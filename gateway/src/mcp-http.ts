/**
 * Streamable HTTP MCP (protocol 2025-03-26).
 * One POST per JSON-RPC message. The response is either a JSON object
 * or an SSE stream whose data lines are JSON-RPC messages.
 */

export type McpHttpSession = {
  request(method: string, params: unknown, id: number): Promise<unknown>
  notify(method: string, params: unknown): Promise<void>
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export function resultFromHttpBody(body: string, contentType: string, id: number): unknown {
  if (contentType.includes('text/event-stream')) {
    const messages: unknown[] = []
    for (const block of body.split(/\n\n/)) {
      const data = block.split(/\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') continue
      messages.push(JSON.parse(data) as unknown)
    }
    const match = messages.find((msg) => msg && typeof msg === 'object' && (msg as { id?: unknown }).id === id) as { error?: { message?: string }; result?: unknown } | undefined
    if (!match) throw new Error('streamable-http response had no message for this request')
    if (match.error) throw new Error(match.error.message ?? 'mcp error')
    return match.result
  }
  const parsed = JSON.parse(body) as { error?: { message?: string }; result?: unknown; id?: unknown }
  if (parsed.error) throw new Error(parsed.error.message ?? 'mcp error')
  return parsed.result
}

export function createMcpHttpSession(url: string, headers: Record<string, string> = {}, fetchImpl: FetchLike = fetch as unknown as FetchLike): McpHttpSession {
  let sessionId: string | undefined
  const post = async (payload: unknown, expectBody: boolean): Promise<{ status: number; contentType: string; body: string }> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(payload),
    })
    const next = res.headers.get('mcp-session-id')
    if (next) sessionId = next
    const body = expectBody || res.ok ? await res.text() : ''
    if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', body }
  }
  return {
    async request(method, params, id) {
      const res = await post({ jsonrpc: '2.0', id, method, params }, true)
      return resultFromHttpBody(res.body, res.contentType, id)
    },
    async notify(method, params) {
      await post({ jsonrpc: '2.0', method, params }, false)
    },
  }
}
