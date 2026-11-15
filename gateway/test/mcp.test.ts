import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runTurn, type AgentEvents } from '../src/agent.js'
import { createApproval, resolveApproval } from '../src/approvals.js'
import { createFakeComputer } from '../src/computer.js'
import { ensureDmThread, listMessages, openDb, upsertBot, type MessageRow } from '../src/db.js'
import { createLLM, type AssistantTurn, type LLM } from '../src/llm.js'
import { feedMcpStream } from '../src/mcp-frames.js'
import { parseServer } from '../src/mcp-config.js'
import { mcpToolAccess } from '../src/mcp-policy.js'
import { resultFromHttpBody } from '../src/mcp-http.js'
import { createMcpHost, type McpHost } from '../src/mcp.js'
import { createSecretStore } from '../src/secrets.js'
import { createApp } from '../src/server.js'
import { buildTools } from '../src/tools.js'

const fixture = fileURLToPath(new URL('../fixtures/mcp-echo.mjs', import.meta.url))
const bot = { id: 'researcher', name: 'Scout', role: 'research', emoji: '🔎', soul_path: '' }
const textTurn: AssistantTurn = { content: 'Done.', toolCalls: [], raw: { role: 'assistant', content: 'Done.' } }
const TOKEN = 'test-token-0123456789abcdef'
const hosts: McpHost[] = []
const stops: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()))
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

function logLines(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
}

describe('mcp stub replay', () => {
  it('calls the approved tool again with the same arguments', async () => {
    const llm = createLLM({
      baseURL: 'http://127.0.0.1', apiKey: '', model: 'stub', extraBody: {}, llmTimeoutMs: 1000, llmRetries: 0,
    })
    const held = JSON.stringify({
      approvalId: 1,
      action: 'MCP mcp_fixture_send_note',
      status: 'approved',
      detail: 'sha256:abc\n{"text":"the original note"}',
    })
    const turn = await llm.chat([
      { role: 'assistant', content: `[held for approval] ${held}` },
      { role: 'user', content: 'Your operator approved: MCP mcp_fixture_send_note. Carry it out now and report what actually happened.' },
    ], [])
    expect(turn.toolCalls).toEqual([
      expect.objectContaining({ name: 'mcp_fixture_send_note', args: { text: 'the original note' } }),
    ])
  })
})

describe('mcp tool policy', () => {
  it('lets reads run and holds anything that can leave the machine', () => {
    expect(mcpToolAccess('echo')).toBe('read')
    expect(mcpToolAccess('send_note')).toBe('outward')
    expect(mcpToolAccess('browser_snapshot')).toBe('read')
    expect(mcpToolAccess('browser_navigate')).toBe('outward')
    expect(mcpToolAccess('browser_click')).toBe('outward')
    expect(mcpToolAccess('get_issue')).toBe('read')
    expect(mcpToolAccess('create_issue')).toBe('outward')
    expect(mcpToolAccess('frobnicate')).toBe('outward')
    expect(mcpToolAccess('delete_screenshot')).toBe('outward')
  })
})

describe('mcp frames', () => {
  it('reads newline JSON and Content-Length frames', () => {
    const newline: unknown[] = []
    const rest = feedMcpStream('', '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n', (msg) => newline.push(msg))
    expect(rest).toBe('')
    expect(newline).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }])

    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } })
    const framed: unknown[] = []
    const leftover = feedMcpStream('', `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, (msg) => framed.push(msg))
    expect(leftover).toBe('')
    expect(framed).toEqual([{ jsonrpc: '2.0', id: 2, result: { tools: [] } }])

    const partial = feedMcpStream('', 'Content-Length: 20\r\n\r\n{"id":', () => {})
    expect(partial.startsWith('Content-Length:')).toBe(true)
  })
})

describe('mcp secrets and config', () => {
  it('substitutes every placeholder, masks values, and reports a missing name', () => {
    const store = createSecretStore(mkdtempSync(join(tmpdir(), 'jackbot-secret-')))
    expect(store.set('demo', 'super-secret-token')).toEqual({ ok: true })
    expect(store.set('other', 'another-secret-value')).toEqual({ ok: true })
    expect(store.substitute('${secret:demo} ${secret:other}')).toEqual({
      ok: true, text: 'super-secret-token another-secret-value',
    })
    expect(store.mask('seen super-secret-token')).toBe('seen •••')
    expect(store.substitute('${secret:nope}')).toEqual({ ok: false, missing: ['nope'] })
    expect(store.list()).toEqual(['demo', 'other'])
  })

  it('rejects a server name the model could confuse with a path', () => {
    expect(parseServer({ name: '1bad', command: 'node' })).toEqual({ error: expect.stringMatching(/invalid MCP server name/) })
    const parsed = parseServer({ name: 'fixture', command: 'node', args: ['echo.mjs'], env: { DEMO_TOKEN: '${secret:demo}' } })
    expect(parsed).toMatchObject({ server: { name: 'fixture', command: 'node', bots: [] } })
  })

  it('validates streamable HTTP server urls and env header keys', () => {
    expect(parseServer({
      name: 'remote', url: 'https://example.com/mcp', command: '', env: { Authorization: 'Bearer ${secret:demo}' },
    })).toMatchObject({
      server: { name: 'remote', url: 'https://example.com/mcp', command: '', bots: [], env: { Authorization: 'Bearer ${secret:demo}' } },
    })
    expect(parseServer({ name: 'badproto', url: 'ftp://example.com/mcp', command: '' })).toEqual({
      error: expect.stringMatching(/http or https/),
    })
    expect(parseServer({
      name: 'badhdr', url: 'https://example.com/mcp', command: '', env: { 'X-Api-Key': '123' },
    })).toEqual({
      error: expect.stringMatching(/invalid env key/),
    })
  })
})

describe('mcp fixture', () => {
  it('runs a read, masks a secret, and holds an outward call until that exact approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-mcp-'))
    const log = join(dir, 'calls.log')
    const previousKey = process.env.JACKBOT_API_KEY
    const previousLog = process.env.JACKBOT_FIXTURE_LOG
    process.env.JACKBOT_API_KEY = 'leak-me-please-key'
    process.env.JACKBOT_FIXTURE_LOG = log
    const host = createMcpHost(dir)
    hosts.push(host)
    const db = openDb(':memory:')
    try {
      expect(host.secrets.set('demo', 'super-secret-token')).toEqual({ ok: true })
      expect(await host.upsert({
        name: 'fixture',
        command: process.execPath,
        args: [fixture],
        env: { DEMO_TOKEN: '${secret:demo}', MISSING_TOKEN: '${secret:missing}' },
        enabled: true,
        bots: [],
      })).toEqual({ ok: true })

      const defs = await host.toolDefs({ botId: 'researcher', watch: false })
      expect(defs.map((tool) => tool.function.name).sort()).toEqual([
        'mcp_fixture_echo', 'mcp_fixture_get_env', 'mcp_fixture_send_note',
      ])
      expect(defs.find((tool) => tool.function.name === 'mcp_fixture_send_note')?.function.description).toMatch(/Outward/)
      expect(await host.toolDefs({ botId: 'researcher', watch: true })).toEqual([])

      const echo = await host.call({ botId: 'researcher', name: 'mcp_fixture_echo', args: { text: 'hello from jackbot' }, watch: false, db })
      expect(echo.text).toBe('echo:hello from jackbot')
      const env = await host.call({ botId: 'researcher', name: 'mcp_fixture_get_env', args: {}, watch: false, db })
      expect(env.text).toBe('token=•••;missing=;leak=')
      expect(env.text).not.toContain('leak-me-please-key')

      const approvals: number[] = []
      const onApproval = async (input: { action: string; detail: string; kind: 'other'; target: string }) => {
        const row = createApproval(db, {
          threadId: 'dm:researcher', botId: 'researcher', action: input.action, detail: input.detail, kind: input.kind, target: input.target,
        })
        approvals.push(row.id)
        return { approvalId: row.id }
      }
      const held = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(held.text.startsWith('Held for')).toBe(true)
      expect(logLines(log)).not.toContain('send_note')

      const other = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'other' }, watch: false, db, onApproval,
      })
      expect(other.text.startsWith('Held for')).toBe(true)
      expect(logLines(log).filter((line) => line === 'send_note')).toEqual([])

      resolveApproval(db, approvals[0]!, 'approve')
      const sent = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(sent.text).toBe('sent:hello')
      expect(logLines(log).filter((line) => line === 'send_note')).toEqual(['send_note'])

      const again = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(again.text.startsWith('Held for')).toBe(true)
      expect(logLines(log).filter((line) => line === 'send_note')).toEqual(['send_note'])

      resolveApproval(db, approvals[1]!, 'discard')
      const discarded = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'other' }, watch: false, db, onApproval,
      })
      expect(discarded.text).toMatch(/discarded/)
      expect(logLines(log).filter((line) => line === 'send_note')).toEqual(['send_note'])

      const watched = await host.call({
        botId: 'researcher', name: 'mcp_fixture_send_note', args: { text: 'hello' }, watch: true, db, onApproval,
      })
      expect(watched.text).toMatch(/not available in a watch routine/)
      expect(logLines(log)).toEqual(['echo', 'get_env', 'send_note'])
    } finally {
      if (previousKey === undefined) delete process.env.JACKBOT_API_KEY
      else process.env.JACKBOT_API_KEY = previousKey
      if (previousLog === undefined) delete process.env.JACKBOT_FIXTURE_LOG
      else process.env.JACKBOT_FIXTURE_LOG = previousLog
    }
  })

  it('still offers the teammate browser after a Playwright preset is saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-preset-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    const started = Date.now()
    const added = await host.addPreset('playwright')
    expect(Date.now() - started).toBeLessThan(3000)
    expect(added.ok).toBe(true)
    const status = await host.statuses()
    expect(status.servers).toEqual([
      expect.objectContaining({ name: 'playwright', state: 'stopped', command: expect.stringContaining('npx') }),
    ])
    expect(buildTools({ hasComputer: true }).map((tool) => tool.function.name)).toContain('browser_goto')
  })

  it('posts an approval chip from a turn and keeps browser_goto beside the connector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-turn-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    expect(await host.upsert({
      name: 'fixture', command: process.execPath, args: [fixture], env: {}, enabled: true, bots: [],
    })).toEqual({ ok: true })
    const db = openDb(':memory:')
    upsertBot(db, bot)
    const threadId = ensureDmThread(db, bot.id)
    const messages: MessageRow[] = []
    const events: AgentEvents = { onMessage: (message) => messages.push(message), onStatus: () => {} }
    const calls: { tools: string[]; toolResults: string[] }[] = []
    const llm: LLM = {
      async chat(messages, tools) {
        calls.push({
          tools: (tools ?? []).map((tool) => tool.function.name),
          toolResults: messages.filter((message) => message.role === 'tool').map((message) => String(message.content ?? '')),
        })
        if (calls.length === 1) {
          return { content: null, toolCalls: [{ id: 'c1', name: 'mcp_fixture_echo', args: { text: 'hi' } }], raw: { role: 'assistant', content: null } }
        }
        if (calls.length === 2) {
          return { content: null, toolCalls: [{ id: 'c2', name: 'mcp_fixture_send_note', args: { text: 'note' } }], raw: { role: 'assistant', content: null } }
        }
        return textTurn
      },
    }
    await runTurn({
      db, llm, bot, soul: '', threadId, mcp: host,
      getComputer: async () => createFakeComputer(),
      onApproval: async (input) => {
        const row = createApproval(db, {
          threadId, botId: bot.id, action: input.action, detail: input.detail, kind: input.kind, target: input.target,
        })
        return { approvalId: row.id }
      },
    }, 'use the mcp connector', events)

    expect(calls[0]!.tools).toEqual(expect.arrayContaining(['browser_goto', 'mcp_fixture_echo', 'mcp_fixture_send_note']))
    expect(calls[1]!.toolResults.some((text) => text.includes('echo:hi'))).toBe(true)
    expect(calls[2]!.toolResults.some((text) => text.startsWith('Held for'))).toBe(true)
    const chip = messages.find((message) => message.kind === 'approval_request')
    expect(chip?.payload).toMatchObject({ kind: 'other', canRemember: false, action: 'MCP mcp_fixture_send_note' })
    expect(listMessages(db, threadId).some((message) => message.kind === 'approval_request')).toBe(true)
  })
})

describe('mcp start failures', () => {
  it('names a missing command and retries once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-missing-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    const command = join(dir, 'missing-bin')
    expect(await host.upsert({ name: 'gone', command, args: [], env: {}, enabled: true, bots: [] })).toEqual({ ok: true })
    const started = Date.now()
    expect(await host.toolDefs({ botId: 'researcher', watch: false })).toEqual([])
    const status = await host.statuses()
    expect(status.servers[0]).toMatchObject({ name: 'gone', state: 'error' })
    expect(status.servers[0]?.error).toMatch(/not found/)
    expect(status.servers[0]?.error).toMatch(/Tried twice/)
    expect(Date.now() - started).toBeLessThan(8_000)
  })
})

describe('mcp streamable http', () => {
  it('reads a JSON result and an SSE result', () => {
    expect(resultFromHttpBody(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), 'application/json', 1)).toEqual({ ok: true })
    const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } })}\n\n`
    expect(resultFromHttpBody(sse, 'text/event-stream', 2)).toEqual({ tools: [] })
  })

  it('lists and calls a tool over streamable HTTP', async () => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method?: string; params?: { arguments?: { text?: string } } }
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
          return
        }
        const result = msg.method === 'initialize'
          ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '0' } }
          : msg.method === 'tools/list'
            ? { tools: [{ name: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
            : { content: [{ type: 'text', text: `echo:${msg.params?.arguments?.text ?? ''}` }] }
        const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })
        if (msg.method === 'tools/list') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' })
          res.end(`event: message\ndata: ${body}\n\n`)
          return
        }
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' })
        res.end(body)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-http-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    try {
      expect(await host.upsert({
        name: 'remote', url: `http://127.0.0.1:${port}/mcp`, command: '', args: [], env: {}, enabled: true, bots: [],
      })).toEqual({ ok: true })
      const defs = await host.toolDefs({ botId: 'researcher', watch: false })
      expect(defs.map((tool) => tool.function.name)).toEqual(['mcp_remote_echo'])
      const db = openDb(':memory:')
      const echo = await host.call({ botId: 'researcher', name: 'mcp_remote_echo', args: { text: 'over http' }, watch: false, db })
      expect(echo.text).toBe('echo:over http')
      const status = await host.statuses()
      expect(status.servers[0]).toMatchObject({ name: 'remote', state: 'ready', command: `http://127.0.0.1:${port}/mcp` })
    } finally {
      await host.stop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('sends substituted headers, tracks mcp-session-id, masks secrets, and holds outward tools', async () => {
    const seen: Array<{ method: string; auth?: string; session?: string }> = []
    const toolCalls: string[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk as Buffer))
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id?: number
          method?: string
          params?: { name?: string; arguments?: { text?: string } }
        }
        seen.push({
          method: msg.method ?? '',
          auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
          session: typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined,
        })
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
          return
        }
        let result: unknown
        if (msg.method === 'initialize') {
          result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '0' } }
        } else if (msg.method === 'tools/list') {
          result = {
            tools: [
              { name: 'echo', description: 'Echo.', inputSchema: { type: 'object', properties: {} } },
              { name: 'send_note', description: 'Send.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            ],
          }
        } else {
          const toolName = msg.params?.name ?? ''
          toolCalls.push(toolName)
          const text = toolName === 'echo'
            ? `auth=${req.headers.authorization ?? ''}`
            : `sent:${msg.params?.arguments?.text ?? ''}`
          result = { content: [{ type: 'text', text }] }
        }
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-xyz' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-http-auth-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    try {
      expect(host.secrets.set('demo', 'super-secret-http-token')).toEqual({ ok: true })
      expect(await host.upsert({
        name: 'remote',
        url: `http://127.0.0.1:${port}/mcp`,
        command: '',
        args: [],
        env: { Authorization: 'Bearer ${secret:demo}' },
        enabled: true,
        bots: [],
      })).toEqual({ ok: true })

      const defs = await host.toolDefs({ botId: 'researcher', watch: false })
      expect(defs.map((tool) => tool.function.name).sort()).toEqual(['mcp_remote_echo', 'mcp_remote_send_note'])
      expect(await host.toolDefs({ botId: 'researcher', watch: true })).toEqual([])

      const db = openDb(':memory:')
      const echo = await host.call({ botId: 'researcher', name: 'mcp_remote_echo', args: {}, watch: false, db })
      expect(echo.text).toBe('auth=Bearer •••')
      expect(echo.text).not.toContain('super-secret-http-token')

      const approvals: number[] = []
      const onApproval = async (input: { action: string; detail: string; kind: 'other'; target: string }) => {
        const row = createApproval(db, {
          threadId: 'dm:researcher', botId: 'researcher', action: input.action, detail: input.detail, kind: input.kind, target: input.target,
        })
        approvals.push(row.id)
        return { approvalId: row.id }
      }

      const held = await host.call({
        botId: 'researcher', name: 'mcp_remote_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(held.text.startsWith('Held for')).toBe(true)
      expect(toolCalls).toEqual(['echo'])

      resolveApproval(db, approvals[0]!, 'approve')
      const sent = await host.call({
        botId: 'researcher', name: 'mcp_remote_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(sent.text).toBe('sent:hello')
      expect(toolCalls).toEqual(['echo', 'send_note'])

      const again = await host.call({
        botId: 'researcher', name: 'mcp_remote_send_note', args: { text: 'hello' }, watch: false, db, onApproval,
      })
      expect(again.text.startsWith('Held for')).toBe(true)
      expect(toolCalls).toEqual(['echo', 'send_note'])

      expect(seen).toEqual([
        { method: 'initialize', auth: 'Bearer super-secret-http-token', session: undefined },
        { method: 'notifications/initialized', auth: 'Bearer super-secret-http-token', session: 'sess-xyz' },
        { method: 'tools/list', auth: 'Bearer super-secret-http-token', session: 'sess-xyz' },
        { method: 'tools/call', auth: 'Bearer super-secret-http-token', session: 'sess-xyz' },
        { method: 'tools/call', auth: 'Bearer super-secret-http-token', session: 'sess-xyz' },
      ])
    } finally {
      await host.stop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('reports missing secrets in streamable HTTP url or header without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-http-missing-'))
    const host = createMcpHost(dir)
    hosts.push(host)
    expect(await host.upsert({
      name: 'badurl',
      url: 'https://example.com/${secret:missing}',
      command: '',
      args: [],
      env: {},
      enabled: true,
      bots: [],
    })).toEqual({ ok: true })
    expect(await host.upsert({
      name: 'badhdr',
      url: 'http://127.0.0.1:1/mcp',
      command: '',
      args: [],
      env: { Authorization: 'Bearer ${secret:missing}' },
      enabled: true,
      bots: [],
    })).toEqual({ ok: true })

    expect(await host.toolDefs({ botId: 'researcher', watch: false })).toEqual([])
    const status = await host.statuses()
    expect(status.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'badurl', state: 'error', error: expect.stringMatching(/missing secret in url: missing/) }),
      expect.objectContaining({ name: 'badhdr', state: 'error', error: expect.stringMatching(/missing secret in header Authorization: missing/) }),
    ]))
  })
})

describe('mcp http', () => {
  it('keeps connectors behind the session and does not start a preset just by saving it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackbot-api-'))
    const db = openDb(':memory:')
    const llm: LLM = { chat: async () => textTurn }
    const gateway = createApp({ db, llm, token: TOKEN, dataDir: dir })
    stops.push(() => gateway.stopMcp())
    expect((await gateway.app.request('/api/mcp')).status).toBe(401)
    const saved = await gateway.app.request('/api/mcp/presets/playwright', {
      method: 'POST',
      headers: { Cookie: `jackbot_session=${TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(saved.status).toBe(200)
    const body = await saved.json() as { note?: string; servers: { name: string; state: string }[] }
    expect(body.note).toMatch(/does not replace|npx|browser/i)
    expect(body.servers).toEqual([expect.objectContaining({ name: 'playwright', state: 'stopped' })])
    const listed = await gateway.app.request('/api/mcp', { headers: { Cookie: `osb_session=${TOKEN}` } })
    expect(listed.status).toBe(200)
    expect(buildTools({ hasComputer: true }).some((tool) => tool.function.name === 'browser_goto')).toBe(true)
  })
})
