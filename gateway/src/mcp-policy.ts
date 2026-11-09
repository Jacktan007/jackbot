/**
 * Whether an MCP tool may run immediately.
 * Unknown names are outward: a connector that can send, write, or spend
 * has to stop for approval, same idea as hold_for_approval for mail and posts.
 * The teammate's own browser tools are not classified here.
 */
const OUTWARD = /(?:^|_)(create|update|delete|send|post|write|put|patch|remove|drop|insert|publish|exec|run|click|type|fill|navigate|goto|press|install|upload|hover|select|evaluate|close|new|submit|call)(?:_|$)/i

const READ = [
  /^(echo|ping|list|get|read|search|fetch|query|describe|status|snapshot|tabs|wait)(_|$)/i,
  /_(echo|list|get|read|search|fetch|query|status|snapshot|tabs)$/i,
  /console_messages/i,
  /network_requests/i,
  /screenshot/i,
  /browser_snapshot/i,
  /browser_tabs/i,
  /browser_console/i,
  /browser_network/i,
  /browser_wait/i,
]

export type McpAccess = 'read' | 'outward'

export function mcpToolAccess(toolName: string): McpAccess {
  const name = toolName.trim()
  if (OUTWARD.test(name)) return 'outward'
  if (READ.some((re) => re.test(name))) return 'read'
  return 'outward'
}
