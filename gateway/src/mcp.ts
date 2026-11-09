import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Db } from './db.js'
import { feedMcpStream, type McpFrame } from './mcp-frames.js'
import { loadMcpConfig, parseServer, saveMcpConfig, type McpServerConfig } from './mcp-config.js'
import { mcpPresets, presetConfig, type McpPreset } from './mcp-catalog.js'
import { mcpToolAccess } from './mcp-policy.js'
import { createSecretStore, type SecretStore } from './secrets.js'
import type { ToolDef } from './llm.js'

/**
 * Stdio MCP client for jackbot.
 * The session loop and ${secret:} env substitution follow nickylin/OpenGrokBot
 * (MIT). Servers are started on the gateway machine, beside the teammate
 * computer — they do not replace its Chromium.
 */

const PROTOCOL_VERSION = '2024-11-05'
const CALL_TIMEOUT_MS = 60_000
const START_BUDGET_MS = 10_000
const MAX_TOOLS = 64

const INHERITED_ENV = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH/i

export type McpServerStatus = {
  name: string
  command: string
  enabled: boolean
  state: 'stopped' | 'starting' | 'ready' | 'error'
  toolCount: number
  tools: string[]
  bots: string[]
  error?: string
}

export type McpApprovalInput = {
  action: string
  detail: string
  kind: 'other'
  target: string
  rulesAllowed: false
}

export type McpCallInput = {
  botId: string
  name: string
  args: Record<string, unknown>
  watch: boolean
  db: Db
  onApproval?: (input: McpApprovalInput) => Promise<{ approvalId: number }>
}

export type McpCallResult = {
  text: string
  approval?: { approvalId: number; action: string; detail: string; target: string }
}

type ToolRoute = { server: string; tool: string }

type ListedTool = { name: string; description?: string; inputSchema?: unknown }

export type McpHost = {
  toolDefs(opts: { botId: string; watch: boolean }): Promise<ToolDef[]>
  call(input: McpCallInput): Promise<McpCallResult>
  statuses(): Promise<{ servers: McpServerStatus[]; presets: McpPreset[]; secrets: string[]; configError?: string }>
  upsert(input: unknown): Promise<{ ok: true } | { ok: false; error: string }>
  remove(name: string): Promise<boolean>
  restart(name: string): Promise<boolean>
  addPreset(id: string): Promise<{ ok: true; note: string } | { ok: false; error: string }>
  secrets: SecretStore
  stop(): Promise<void>
}

export function createMcpHost(dataDir: string): McpHost {
  const secrets = createSecretStore(dataDir)
  const servers = new Map<string, Managed>()
  const routes = new Map<string, ToolRoute>()
  const usedApprovals = new Set<number>()
  let configError: string | undefined

  const sync = (): void => {
    const loaded = loadMcpConfig(dataDir)
    configError = loaded.error
    const wanted = new Map(loaded.servers.map((server) => [server.name, server]))
    for (const [name, managed] of servers) {
      const next = wanted.get(name)
      if (!next || JSON.stringify(next) !== JSON.stringify(managed.config)) {
        managed.conn.stop()
        servers.delete(name)
      }
    }
    for (const [name, config] of wanted) {
      if (!servers.has(name)) servers.set(name, { config, conn: new McpConnection(config, secrets) })
    }
    rebuildRoutes()
  }

  const rebuildRoutes = (): void => {
    routes.clear()
    const used = new Set<string>()
    for (const [name, managed] of servers) {
      if (managed.config.enabled === false || managed.conn.state !== 'ready') continue
      for (const tool of managed.conn.tools) {
        const publicName = mcpToolName(name, tool.name, used)
        routes.set(publicName, { server: name, tool: tool.name })
      }
    }
  }

  const visible = (config: McpServerConfig, botId: string): boolean =>
    config.enabled !== false && (config.bots.length === 0 || config.bots.includes(botId))

  return {
    secrets,
    async toolDefs({ botId, watch }) {
      if (watch) return []
      sync()
      const pending = [...servers.values()]
        .filter((managed) => visible(managed.config, botId) && managed.conn.state === 'stopped')
        .map((managed) => Promise.race([
          managed.conn.start().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, START_BUDGET_MS)),
        ]))
      if (pending.length) await Promise.all(pending)
      rebuildRoutes()
      const defs: ToolDef[] = []
      for (const [name, managed] of servers) {
        if (!visible(managed.config, botId) || managed.conn.state !== 'ready') continue
        for (const tool of managed.conn.tools) {
          const publicName = [...routes.entries()].find(([, route]) => route.server === name && route.tool === tool.name)?.[0]
          if (!publicName) continue
          const access = mcpToolAccess(tool.name)
          defs.push({
            type: 'function',
            function: {
              name: publicName,
              description: `[MCP:${name}] ${tool.description ?? tool.name}`.slice(0, 500)
                + (access === 'outward' ? ' Outward: held for operator approval before it runs.' : ''),
              parameters: parametersOf(tool.inputSchema),
            },
          })
          if (defs.length >= MAX_TOOLS) return defs
        }
      }
      return defs
    },
    async call(input) {
      if (input.watch) {
        return { text: `${input.name} is not available in a watch routine. This run only looks with the computer's read-only tools.` }
      }
      sync()
      rebuildRoutes()
      const route = routes.get(input.name)
      if (!route) return { text: `Unknown MCP tool ${input.name}. It is not on a ready connector for this teammate.` }
      const managed = servers.get(route.server)
      if (!managed || !visible(managed.config, input.botId)) {
        return { text: `MCP server ${route.server} is not enabled for this teammate.` }
      }
      if (mcpToolAccess(route.tool) === 'outward') {
        const fingerprint = fingerprintArgs(input.args)
        const action = `MCP ${input.name}`
        const existing = latestApproval(input.db, input.botId, action, fingerprint)
        if (existing?.status === 'pending') {
          return { text: "Held for your operator's approval. Stop here — do not perform it." }
        }
        if (existing?.status === 'discarded') {
          return { text: 'Your operator discarded this MCP call. Do not retry it unless they ask for it again.' }
        }
        if (existing?.status === 'approved' && !usedApprovals.has(existing.id)) {
          usedApprovals.add(existing.id)
          return { text: await managed.conn.callTool(route.tool, input.args) }
        }
        if (!input.onApproval) {
          return { text: 'This MCP tool can change something outside the workspace, and approvals are not available. It was not called.' }
        }
        const detail = `${fingerprint}\n${secrets.mask(stableStringify(input.args)).slice(0, 500)}`
        const answer = await input.onApproval({ action, detail, kind: 'other', target: input.name, rulesAllowed: false })
        return {
          text: "Held for your operator's approval. Stop here — do not perform it.",
          approval: { approvalId: answer.approvalId, action, detail, target: input.name },
        }
      }
      if (managed.conn.state !== 'ready') {
        await managed.conn.start().catch(() => undefined)
      }
      return { text: await managed.conn.callTool(route.tool, input.args) }
    },
    async statuses() {
      sync()
      return {
        servers: [...servers.values()].map((managed) => ({
          name: managed.config.name,
          command: [managed.config.command, ...managed.config.args].join(' '),
          enabled: managed.config.enabled !== false,
          state: managed.conn.state,
          toolCount: managed.conn.tools.length,
          tools: managed.conn.tools.map((tool) => tool.name),
          bots: managed.config.bots,
          ...(managed.conn.error ? { error: secrets.mask(managed.conn.error) } : {}),
        })),
        presets: mcpPresets(),
        secrets: secrets.list(),
        ...(configError ? { configError: secrets.mask(configError) } : {}),
      }
    },
    async upsert(input) {
      const parsed = parseServer(input)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      const loaded = loadMcpConfig(dataDir)
      if (loaded.error && loaded.servers.length === 0 && loaded.error.startsWith('mcp.json')) {
        return { ok: false, error: loaded.error }
      }
      const next = loaded.servers.filter((server) => server.name !== parsed.server.name)
      next.push(parsed.server)
      saveMcpConfig(dataDir, next)
      sync()
      return { ok: true }
    },
    async remove(name) {
      const loaded = loadMcpConfig(dataDir)
      const next = loaded.servers.filter((server) => server.name !== name)
      if (next.length === loaded.servers.length) return false
      saveMcpConfig(dataDir, next)
      sync()
      return true
    },
    async restart(name) {
      sync()
      const managed = servers.get(name)
      if (!managed) return false
      managed.conn.stop()
      const fresh = new McpConnection(managed.config, secrets)
      servers.set(name, { config: managed.config, conn: fresh })
      await fresh.start().catch(() => undefined)
      rebuildRoutes()
      return true
    },
    async addPreset(id) {
      const config = presetConfig(id, dataDir)
      if (!config) return { ok: false, error: `unknown preset "${id}"` }
      const loaded = loadMcpConfig(dataDir)
      const next = loaded.servers.filter((server) => server.name !== config.name)
      next.push(config)
      saveMcpConfig(dataDir, next)
      sync()
      const preset = mcpPresets().find((item) => item.id === id)
      const note = preset?.argHint
        ?? 'Added. It does not replace the teammate computer. Tools appear on the next turn, or after Restart.'
      return { ok: true, note }
    },
    async stop() {
      for (const managed of servers.values()) managed.conn.stop()
      servers.clear()
      routes.clear()
    },
  }
}

type Managed = { config: McpServerConfig; conn: McpConnection }

function mcpToolName(server: string, tool: string, used: Set<string>): string {
  const sanitize = (part: string) => part.replace(/[^a-zA-Z0-9_-]/g, '_')
  let name = `mcp_${sanitize(server)}_${sanitize(tool)}`.slice(0, 64)
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const suffix = createHash('sha256').update(`${server}\0${tool}`).digest('hex').slice(0, 4)
  name = `${name.slice(0, 59)}_${suffix}`
  used.add(name)
  return name
}

function parametersOf(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const rec = schema as Record<string, unknown>
    if (rec.type === 'object' || rec.properties) return rec
  }
  return { type: 'object', properties: {} }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const rec = value as Record<string, unknown>
  return `{${Object.keys(rec).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`).join(',')}}`
}

export function fingerprintArgs(args: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(stableStringify(args)).digest('hex')}`
}

function latestApproval(db: Db, botId: string, action: string, fingerprint: string): { id: number; status: string } | null {
  const rows = db.prepare(
    'SELECT id, status, detail FROM approvals WHERE bot_id = ? AND action = ? ORDER BY id DESC LIMIT 20',
  ).all(botId, action) as { id: number; status: string; detail: string }[]
  const hit = rows.find((row) => row.detail.startsWith(`${fingerprint}\n`) || row.detail === fingerprint)
  return hit ? { id: hit.id, status: hit.status } : null
}

function inheritedEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (INHERITED_ENV.test(key)) continue
    out[key] = value
  }
  return out
}

class McpConnection {
  state: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped'
  error?: string
  tools: ListedTool[] = []
  private proc?: ChildProcessWithoutNullStreams
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  private nextId = 1
  private starting?: Promise<void>
  private stderrTail = ''

  constructor(
    private config: McpServerConfig,
    private secrets: SecretStore,
  ) {}

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.state === 'starting' && this.starting) return this.starting
    this.state = 'starting'
    this.error = undefined
    this.starting = this.doStart()
    return this.starting
  }

  private async doStart(): Promise<void> {
    const env: Record<string, string> = {}
    const missingEnv: string[] = []
    for (const [key, raw] of Object.entries(this.config.env)) {
      const substituted = this.secrets.substitute(raw)
      if (substituted.ok) env[key] = substituted.text
      else missingEnv.push(...substituted.missing.map((name) => `${key}: ${name}`))
    }
    const args: string[] = []
    for (const arg of this.config.args) {
      const substituted = this.secrets.substitute(arg)
      if (!substituted.ok) {
        this.failStart(`missing secret in args: ${substituted.missing.join(', ')}`)
        return
      }
      args.push(substituted.text)
    }
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(this.config.command, args, {
        env: { ...inheritedEnv(), ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      this.failStart(err instanceof Error ? err.message : String(err))
      return
    }
    this.proc = proc
    proc.on('error', (err) => this.failStart(err.message))
    proc.on('exit', (code) => {
      if (this.state === 'stopped' || this.state === 'error') return
      this.failStart(`server exited (code ${code ?? '?'})${this.stderrTail ? `: ${this.secrets.mask(this.stderrTail)}` : ''}`)
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-400)
    })
    proc.stdout.setEncoding('utf8')
    let buffer = ''
    proc.stdout.on('data', (chunk: string) => {
      buffer = feedMcpStream(buffer, chunk, (msg) => this.onFrame(msg))
    })
    if (missingEnv.length) this.stderrTail = `dropped env, missing secrets: ${missingEnv.join(', ')}`
    try {
      await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: 'jackbot', version: '0.1.0' },
      })
      await this.notify('notifications/initialized', {})
      const listed = await this.request('tools/list', {}) as { tools?: ListedTool[] }
      this.tools = Array.isArray(listed?.tools) ? listed.tools.filter((tool) => tool && typeof tool.name === 'string') : []
      this.state = 'ready'
      this.error = undefined
    } catch (err) {
      this.failStart(err instanceof Error ? err.message : String(err))
    }
  }

  private failStart(message: string): void {
    this.state = 'error'
    this.error = this.secrets.mask(message)
    this.failAll(new Error(this.error))
    this.kill()
  }

  private onFrame(msg: McpFrame): void {
    const id = typeof msg.id === 'number' ? msg.id : undefined
    if (id !== undefined && this.pending.has(id)) {
      const waiter = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(waiter.timer)
      if (msg.error) waiter.reject(new Error(msg.error.message ?? 'mcp error'))
      else waiter.resolve(msg.result)
      return
    }
    if (id !== undefined && typeof msg.method === 'string') {
      void this.notifyRaw({ jsonrpc: '2.0', id, error: { code: -32601, message: `jackbot does not implement ${msg.method}` } })
    }
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    this.pending.clear()
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const proc = this.proc
    if (!proc) return Promise.reject(new Error('mcp server not started'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`mcp ${method} timed out`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      void this.notifyRaw({ jsonrpc: '2.0', id, method, params }).catch((err: Error) => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err)
      })
    })
  }

  private notify(method: string, params: unknown): Promise<void> {
    return this.notifyRaw({ jsonrpc: '2.0', method, params })
  }

  private notifyRaw(payload: unknown): Promise<void> {
    const proc = this.proc
    if (!proc || !proc.stdin.writable) return Promise.reject(new Error('mcp server stdin is closed'))
    const line = `${JSON.stringify(payload)}\n`
    if (proc.stdin.write(line)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      proc.stdin.once('drain', resolve)
      proc.stdin.once('error', reject)
    })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.state !== 'ready') {
      return `MCP server ${this.config.name} is not ready${this.error ? `: ${this.error}` : ''}`
    }
    try {
      const result = await this.request('tools/call', { name, arguments: args }) as {
        content?: Array<{ type?: string; text?: string }>
        isError?: boolean
      }
      const parts = (result.content ?? []).map((part) => (part.type === 'text' ? part.text ?? '' : `[${part.type ?? 'content'} omitted]`))
      const text = parts.join('\n').slice(0, 8000)
      const masked = this.secrets.mask(text)
      if (result.isError) return JSON.stringify({ error: masked || 'mcp tool error' })
      return masked || '(empty result)'
    } catch (err) {
      return `MCP tool ${name} failed: ${this.secrets.mask(err instanceof Error ? err.message : String(err))}`
    }
  }

  stop(): void {
    this.state = 'stopped'
    this.failAll(new Error('mcp server stopped'))
    this.kill()
    this.tools = []
    this.starting = undefined
  }

  private kill(): void {
    const proc = this.proc
    this.proc = undefined
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // Already gone.
    }
  }
}
