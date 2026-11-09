import type { Hono } from 'hono'
import type { McpHost } from './mcp.js'

/** Operator-only MCP routes. Mounted behind the same auth gate as the rest of the API. */
export function mountMcp(app: Hono, mcp: McpHost): void {
  app.get('/api/mcp', async (c) => c.json(await mcp.statuses()))

  app.post('/api/mcp/servers', async (c) => {
    const body = await c.req.json().catch(() => null)
    const saved = await mcp.upsert(body)
    if (!saved.ok) return c.json({ error: saved.error }, 400)
    return c.json({ ok: true, ...(await mcp.statuses()) })
  })

  app.delete('/api/mcp/servers/:name', async (c) => {
    const removed = await mcp.remove(c.req.param('name'))
    if (!removed) return c.json({ error: 'unknown MCP server' }, 404)
    return c.json({ ok: true, ...(await mcp.statuses()) })
  })

  app.post('/api/mcp/servers/:name/restart', async (c) => {
    const ok = await mcp.restart(c.req.param('name'))
    if (!ok) return c.json({ error: 'unknown MCP server' }, 404)
    return c.json({ ok: true, ...(await mcp.statuses()) })
  })

  app.post('/api/mcp/presets/:id', async (c) => {
    const added = await mcp.addPreset(c.req.param('id'))
    if (!added.ok) return c.json({ error: added.error }, 400)
    return c.json({ ok: true, note: added.note, ...(await mcp.statuses()) })
  })

  app.put('/api/mcp/secrets/:name', async (c) => {
    const body = await c.req.json().catch(() => null) as { value?: unknown } | null
    if (!body || typeof body.value !== 'string') return c.json({ error: 'value must be a string' }, 400)
    const saved = mcp.secrets.set(c.req.param('name'), body.value)
    if (!saved.ok) return c.json({ error: saved.error }, 400)
    return c.json({ ok: true, secrets: mcp.secrets.list() })
  })

  app.delete('/api/mcp/secrets/:name', (c) => {
    const removed = mcp.secrets.delete(c.req.param('name'))
    if (!removed) return c.json({ error: 'unknown secret' }, 404)
    return c.json({ ok: true, secrets: mcp.secrets.list() })
  })
}
