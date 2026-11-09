import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { restrictToOwner } from './auth.js'

/**
 * ${secret:name} substitution for MCP server env and args.
 * Adapted from nickylin/OpenGrokBot (MIT). Values live in <data>/secrets.json
 * (owner-only) and are masked out of tool text before a model sees it.
 */

export const SECRET_PLACEHOLDER_RE = /\$\{secret:([a-z0-9][a-z0-9._-]{0,63})\}/g
export const SECRET_MASK = '•••'
const MIN_MASK_LENGTH = 4
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type SecretStore = {
  list(): string[]
  get(name: string): string | undefined
  set(name: string, value: string): { ok: true } | { ok: false; error: string }
  delete(name: string): boolean
  mask(text: string): string
  substitute(text: string): { ok: true; text: string } | { ok: false; missing: string[] }
}

export function createSecretStore(
  dataDir: string,
  opts: { restrict?: (path: string) => void } = {},
): SecretStore {
  const path = join(dataDir, 'secrets.json')
  const restrict = opts.restrict ?? restrictToOwner

  const read = (): { values: Record<string, string>; corrupt: boolean } => {
    if (!existsSync(path)) return { values: {}, corrupt: false }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { values: {}, corrupt: true }
      const values: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && NAME_RE.test(key)) values[key] = value
      }
      return { values, corrupt: false }
    } catch {
      return { values: {}, corrupt: true }
    }
  }

  const write = (values: Record<string, string>): void => {
    mkdirSync(dataDir, { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 })
    try {
      restrict(tmp)
    } catch {
      // Same as the gateway token: keep the file, the mode is best-effort.
    }
    renameSync(tmp, path)
  }

  return {
    list() {
      return Object.keys(read().values).sort()
    },
    get(name) {
      return read().values[name]
    },
    set(name, value) {
      if (!NAME_RE.test(name)) return { ok: false, error: 'secret name must match [a-z0-9][a-z0-9._-]{0,63}' }
      const trimmed = value.trim()
      if (!trimmed || trimmed.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
        return { ok: false, error: 'secret value must be 1–4096 characters without control characters' }
      }
      const current = read()
      if (current.corrupt) return { ok: false, error: 'secrets.json is not valid JSON; fix or remove it before writing' }
      write({ ...current.values, [name]: trimmed })
      return { ok: true }
    },
    delete(name) {
      const current = read()
      if (!(name in current.values)) return false
      const next = { ...current.values }
      delete next[name]
      if (Object.keys(next).length === 0) rmSync(path, { force: true })
      else write(next)
      return true
    },
    mask(text) {
      if (!text) return text
      const values = Object.values(read().values).filter((v) => v.length >= MIN_MASK_LENGTH).sort((a, b) => b.length - a.length)
      let out = text
      for (const value of values) {
        if (out.includes(value)) out = out.split(value).join(SECRET_MASK)
      }
      return out
    },
    substitute(text) {
      const names = new Set<string>()
      const re = new RegExp(SECRET_PLACEHOLDER_RE.source, 'g')
      for (const match of text.matchAll(re)) names.add(match[1]!)
      if (names.size === 0) return { ok: true, text }
      const values = read().values
      const missing: string[] = []
      let out = text
      for (const name of names) {
        const value = values[name]
        if (value === undefined) missing.push(name)
        else out = out.split(`\${secret:${name}}`).join(value)
      }
      if (missing.length) return { ok: false, missing }
      return { ok: true, text: out }
    },
  }
}
