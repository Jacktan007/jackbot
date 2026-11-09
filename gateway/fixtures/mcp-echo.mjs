/**
 * Tiny stdio MCP server for tests and the offline demo.
 * Tools: echo (read), get_env (read), send_note (outward).
 * Set JACKBOT_FIXTURE_LOG to append one line per tools/call.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function log(line) {
  const file = process.env.JACKBOT_FIXTURE_LOG
  if (file) appendFileSync(file, `${line}\n`)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'jackbot-fixture', version: '0.1.0' },
    })
    return
  }
  if (msg.id === undefined) return
  if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo text back. Read-only.',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        {
          name: 'get_env',
          description: 'Show whether the demo secret was substituted into the environment.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'send_note',
          description: 'Send a note outward.',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      ],
    })
    return
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name
    const args = msg.params?.arguments ?? {}
    log(String(name))
    let text = 'unknown'
    if (name === 'echo') text = `echo:${args.text ?? ''}`
    else if (name === 'get_env') {
      text = `token=${process.env.DEMO_TOKEN ?? ''};missing=${process.env.MISSING_TOKEN ?? ''};leak=${process.env.JACKBOT_API_KEY ?? ''}`
    }
    else if (name === 'send_note') text = `sent:${args.text ?? ''}`
    reply(msg.id, { content: [{ type: 'text', text }] })
    return
  }
  reply(msg.id, { content: [{ type: 'text', text: 'unsupported' }], isError: true })
})
