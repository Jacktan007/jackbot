import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One stdio MCP server in <data>/mcp.json. */
export type McpServerConfig = {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  /** Empty means every teammate. */
  bots: string[]
}

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,32}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const BOT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function mcpConfigPath(dataDir: string): string {
  return join(dataDir, 'mcp.json')
}

export function loadMcpConfig(dataDir: string): { servers: McpServerConfig[]; error?: string } {
  const path = mcpConfigPath(dataDir)
  if (!existsSync(path)) return { servers: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { servers: [], error: `mcp.json is not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
  const root = parsed as { servers?: unknown }
  if (!root || typeof root !== 'object' || !Array.isArray(root.servers)) {
    return { servers: [], error: 'mcp.json must be { "servers": [ ... ] }' }
  }
  const servers: McpServerConfig[] = []
  const errors: string[] = []
  for (const entry of root.servers) {
    const parsedEntry = parseServer(entry)
    if ('error' in parsedEntry) errors.push(parsedEntry.error)
    else servers.push(parsedEntry.server)
  }
  return { servers, ...(errors.length ? { error: errors.join('; ') } : {}) }
}

export function parseServer(input: unknown): { server: McpServerConfig } | { error: string } {
  const rec = (input ?? {}) as Record<string, unknown>
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  const command = typeof rec.command === 'string' ? rec.command.trim() : ''
  if (!NAME_RE.test(name)) return { error: `invalid MCP server name "${name}"` }
  if (!command || command.length > 300 || /[\u0000-\u001f]/.test(command)) return { error: `${name}: command is missing or invalid` }
  const argsIn = Array.isArray(rec.args) ? rec.args : []
  if (argsIn.length > 40) return { error: `${name}: too many args` }
  const args: string[] = []
  for (const arg of argsIn) {
    if (typeof arg !== 'string' || arg.length > 500 || /[\u0000-\u001f]/.test(arg)) return { error: `${name}: invalid arg` }
    args.push(arg)
  }
  const env: Record<string, string> = {}
  if (rec.env !== undefined) {
    if (!rec.env || typeof rec.env !== 'object' || Array.isArray(rec.env)) return { error: `${name}: env must be an object` }
    const entries = Object.entries(rec.env as Record<string, unknown>)
    if (entries.length > 40) return { error: `${name}: too many env entries` }
    for (const [key, value] of entries) {
      if (!ENV_KEY_RE.test(key)) return { error: `${name}: invalid env key ${key}` }
      if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0008]/.test(value)) return { error: `${name}: invalid env value for ${key}` }
      env[key] = value
    }
  }
  const bots: string[] = []
  if (rec.bots !== undefined) {
    if (!Array.isArray(rec.bots)) return { error: `${name}: bots must be an array of teammate ids` }
    for (const bot of rec.bots) {
      const id = typeof bot === 'string' ? bot.trim() : ''
      if (!BOT_RE.test(id)) return { error: `${name}: invalid teammate id "${id}"` }
      bots.push(id)
    }
  }
  return {
    server: {
      name,
      command,
      args,
      env,
      enabled: rec.enabled !== false,
      bots,
    },
  }
}

export function saveMcpConfig(dataDir: string, servers: McpServerConfig[]): void {
  mkdirSync(dataDir, { recursive: true })
  const path = mcpConfigPath(dataDir)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ servers }, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}
