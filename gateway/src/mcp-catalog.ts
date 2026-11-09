import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerConfig } from './mcp-config.js'

/**
 * Stdio presets. Playwright and Chrome DevTools come from nickylin/OpenGrokBot.
 * The rest of the list is the stdio slice of the Z4YT0N/OpenGrokBot marketplace
 * (HTTP connectors such as Vercel are not in this client).
 * None of these replace a teammate's built-in Chromium computer.
 */

export type McpPreset = {
  id: string
  name: string
  category: string
  description: string
  /** Env keys the operator should put in the vault as ${secret:…}. */
  secrets: { name: string; label: string }[]
  argHint?: string
}

export function mcpPresets(): McpPreset[] {
  return [
    {
      id: 'playwright',
      name: 'Playwright',
      category: 'Browser',
      description: 'A second browser via Microsoft Playwright MCP, with its own profile. Your teammate computer and its logins stay as they are.',
      secrets: [],
      argHint: 'Uses npx @playwright/mcp. The first Restart downloads it. This does not replace the built-in browser.',
    },
    {
      id: 'devtools',
      name: 'Chrome DevTools',
      category: 'Browser',
      description: 'Google Chrome DevTools MCP. Separate from the teammate computer. Needs a local Chrome it can attach to.',
      secrets: [],
    },
    {
      id: 'github',
      name: 'GitHub',
      category: 'Featured',
      description: 'Issues, pull requests, and repository search.',
      secrets: [{ name: 'github.token', label: 'Personal access token' }],
    },
    {
      id: 'filesystem',
      name: 'Filesystem',
      category: 'Featured',
      description: 'Read and write one extra folder. Defaults to an empty directory under the gateway data dir, not a teammate workspace.',
      secrets: [],
      argHint: 'The last argument is the folder this server may touch. Change it before Restart if you want a different directory.',
    },
    {
      id: 'memory',
      name: 'Memory graph',
      category: 'Productivity',
      description: 'A small knowledge graph. This is not the teammate MEMORY.md file.',
      secrets: [],
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential thinking',
      category: 'Productivity',
      description: 'Structured step-by-step reasoning.',
      secrets: [],
    },
    {
      id: 'context7',
      name: 'Context7',
      category: 'Developer',
      description: 'Library documentation lookup.',
      secrets: [],
    },
    {
      id: 'slack',
      name: 'Slack',
      category: 'Productivity',
      description: 'Read channels and post messages. Posting is an outward tool and waits for approval.',
      secrets: [
        { name: 'slack.bot', label: 'Bot token' },
        { name: 'slack.team', label: 'Team id' },
      ],
    },
    {
      id: 'notion',
      name: 'Notion',
      category: 'Productivity',
      description: 'Search and edit Notion. Writes wait for approval.',
      secrets: [{ name: 'notion.token', label: 'Integration token' }],
    },
  ]
}

export function presetConfig(id: string, dataDir: string): McpServerConfig | null {
  const base = { enabled: true, bots: [] as string[], env: {} as Record<string, string> }
  switch (id) {
    case 'playwright':
      return {
        ...base,
        name: 'playwright',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--browser', 'chromium', '--user-data-dir', join(dataDir, 'mcp', 'playwright-profile')],
      }
    case 'devtools':
      return {
        ...base,
        name: 'devtools',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest', '--no-usage-statistics'],
      }
    case 'github':
      return {
        ...base,
        name: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secret:github.token}' },
      }
    case 'filesystem': {
      const root = join(dataDir, 'mcp', 'filesystem-root')
      mkdirSync(root, { recursive: true })
      return {
        ...base,
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', root],
      }
    }
    case 'memory':
      return { ...base, name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
    case 'sequential-thinking':
      return { ...base, name: 'sequential-thinking', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }
    case 'context7':
      return { ...base, name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] }
    case 'slack':
      return {
        ...base,
        name: 'slack',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: { SLACK_BOT_TOKEN: '${secret:slack.bot}', SLACK_TEAM_ID: '${secret:slack.team}' },
      }
    case 'notion':
      return {
        ...base,
        name: 'notion',
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { NOTION_TOKEN: '${secret:notion.token}' },
      }
    default:
      return null
  }
}
