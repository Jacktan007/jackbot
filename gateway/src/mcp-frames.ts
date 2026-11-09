/**
 * MCP stdio frames. jackbot writes newline-delimited JSON (the 2024-11-05
 * stdio shape used by the OpenGrokBot client this was fused from).
 * Responses may be newline JSON or LSP-style Content-Length frames.
 */

export type McpFrame = Record<string, unknown> & { id?: number | string; method?: string; result?: unknown; error?: { message?: string } }

export function feedMcpStream(buffer: string, chunk: string, onMessage: (msg: McpFrame) => void): string {
  let buf = buffer + chunk
  for (;;) {
    if (buf.length === 0) return buf
    if (/^content-length:/i.test(buf)) {
      const crlf = buf.indexOf('\r\n\r\n')
      const lf = buf.indexOf('\n\n')
      let headerEnd = -1
      let sepLen = 4
      if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
        headerEnd = crlf
        sepLen = 4
      } else if (lf !== -1) {
        headerEnd = lf
        sepLen = 2
      }
      if (headerEnd === -1) return buf
      const match = /^content-length:\s*(\d+)/i.exec(buf.slice(0, headerEnd))
      if (!match) {
        buf = buf.slice(headerEnd + sepLen)
        continue
      }
      const len = Number(match[1])
      const start = headerEnd + sepLen
      if (buf.length < start + len) return buf
      const body = buf.slice(start, start + len)
      buf = buf.slice(start + len)
      parseOne(body, onMessage)
      continue
    }
    const nl = buf.indexOf('\n')
    if (nl === -1) return buf
    const line = buf.slice(0, nl).replace(/\r$/, '').trim()
    buf = buf.slice(nl + 1)
    if (line.startsWith('{')) parseOne(line, onMessage)
  }
}

function parseOne(body: string, onMessage: (msg: McpFrame) => void): void {
  try {
    const msg = JSON.parse(body) as unknown
    if (msg && typeof msg === 'object') onMessage(msg as McpFrame)
  } catch {
    // A log line on stdout is not a frame.
  }
}
