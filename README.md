# jackbot

Self-hosted teammates with their own computers. Bring your own API key.

jackbot is a gateway, a thread UI, and one computer per teammate: a real Chromium, a folder, and a shell. Approvals, memory, routines, and group handoffs stay on that path. MCP connectors are extra tools beside the computer. They do not replace it.

This is the closest open build in this repo to the xAI / Cursor Grok Bot shape. It is not Grok Bot, and it does not call a private Grok Bot API. The map of what matches and what does not is in [docs/grok-bot-parity.md](docs/grok-bot-parity.md). 中文说明：[README.zh-CN.md](README.zh-CN.md).

## Where the code comes from

| Piece | Upstream | What jackbot keeps |
| --- | --- | --- |
| Gateway, web UI, per-teammate computer, approvals, memory, routines | [wolfqing/OpenSuperBot](https://github.com/wolfqing/OpenSuperBot) (MIT), formerly OpenGrokBot | The whole product. This is the base. |
| Stdio MCP client, `${secret:}` vault, Playwright and Chrome DevTools presets | [nickylin/OpenGrokBot](https://github.com/nickylin/OpenGrokBot) (MIT) | The client and those presets, reimplemented in the gateway. Not that app's CLI harnesses. |
| Extra stdio presets | [Z4YT0N/OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot) marketplace (MIT) | GitHub, filesystem, memory graph, sequential thinking, Context7, Slack, Notion. Not the CLI employees, and not HTTP MCP. |

Licenses: [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Quick start

You need Node.js 22+ and pnpm 10.

1. `pnpm install`
2. Offline, no key: `JACKBOT_MODEL=stub pnpm dev`
3. Open the sign-in URL the terminal prints. The UI is <http://127.0.0.1:47821> and the gateway is <http://127.0.0.1:4747>. Without that link, `/api/session` is 401. The token file is `gateway/data/auth-token`.

A real model needs a key. If you start without `JACKBOT_MODEL=stub` and without a key, the gateway prints that and still boots, but turns cannot call a model:

```bash
export JACKBOT_API_KEY="your key"
export JACKBOT_API_BASE="https://api.x.ai/v1"   # or http://localhost:11434/v1
export JACKBOT_MODEL="grok-4.7"
pnpm dev
```

`JACKBOT_*` wins. A blank value does not hide `OPENSUPERBOT_*` or `OPENGROKBOT_*`.

## Run it

Node.js 22 or newer, and pnpm 10.

```bash
pnpm install
JACKBOT_MODEL=stub pnpm dev
```

- UI: <http://127.0.0.1:47821>
- Gateway: <http://127.0.0.1:4747> (the UI proxies to it)
- The terminal prints a sign-in link. The token file is `gateway/data/auth-token`. Opening the UI without that link returns 401 on `/api/session`.

`JACKBOT_MODEL=stub` uses a scripted model. No API key and no network. Say a URL and the stub opens it with `browser_goto`. Say "mcp" or "connector" and it calls the fixture tools below, if that server is configured.

A real model, any OpenAI-compatible server (xAI is the default base):

```bash
export JACKBOT_API_KEY="your key"
export JACKBOT_API_BASE="https://api.x.ai/v1"   # or http://localhost:11434/v1, or another /v1
export JACKBOT_MODEL="grok-4.7"
pnpm dev
```

Production build: `pnpm build` then `pnpm start`. The gateway serves `web/dist`.

### Environment

`JACKBOT_*` wins. If that name is unset or blank, `OPENSUPERBOT_*` is used, then `OPENGROKBOT_*`. A blank value does not hide a real value under an older name.

| Variable | Purpose | Default |
| --- | --- | --- |
| `JACKBOT_API_KEY` | Model key | empty |
| `JACKBOT_API_BASE` | OpenAI-compatible base URL | `https://api.x.ai/v1` |
| `JACKBOT_MODEL` | Model id. `stub` is the offline model | `grok-4.7` |
| `JACKBOT_DATA` | Data directory (db, token, mcp.json, secrets) | `gateway/data` |
| `JACKBOT_PORT` | Gateway port | `4747` |
| `JACKBOT_HOST` | Gateway bind address | `127.0.0.1` |
| `JACKBOT_WEB_URL` | URL printed for sign-in | `http://127.0.0.1:47821` in dev |
| `JACKBOT_COMPUTERS` | `auto`, `docker`, or `local` | `auto` |
| `JACKBOT_BROWSER` | Chromium executable for local computers | discover, or download |
| `JACKBOT_DAILY_TOKENS` | Per-teammate daily token cap | unlimited |
| `JACKBOT_TOKEN` | Fixed gateway token instead of the file | file in the data dir |

The database file is `jackbot.db`. An existing `opensuperbot.db` or `opengrokbot.db` is kept when `jackbot.db` is not there yet.

Docker computers still use the image `opensuperbot/bot:dev` and containers named `opensuperbot-<id>`. Build it with the upstream computer Dockerfile under `computer/` when you want Docker rather than a local browser. `JACKBOT_COMPUTERS=local` skips Docker.

## Architecture

```
browser  →  Vite UI :47821  →  gateway :4747  →  model (your key, or stub)
                                  │
                                  ├─ one computer per teammate
                                  │    Docker (opensuperbot/bot:dev) or local Chromium + folder
                                  │    shell, files, browser_goto / extract / click / screenshot
                                  │
                                  └─ MCP servers on the gateway machine
                                       stdio JSON-RPC, tools mcp_<server>_<tool>
```

The gateway is Hono and SQLite (`@jackbot/gateway`). The UI is React and Vite (`@jackbot/web`). A turn builds the teammate's own tools first, then appends MCP tools for that teammate. Watch routines only receive the computer's read-only tools.

MCP is started by the gateway user, on the host, not inside the teammate container. That is a real isolation gap. See the parity doc.

## Connectors

Open **MCP** in the sidebar (the button appears when `/api/mcp` is available). Presets:

- Playwright and Chrome DevTools, each with its own profile. These are a second browser. The teammate computer and its logins stay as they are. Saving a preset does not download anything. Restart, or the next turn that needs the tools, runs `npx`.
- GitHub, Slack, and Notion, with tokens stored as secrets (`${secret:github.token}` and the others named in the dialog).
- Filesystem, defaulting to an empty folder under the data dir, not a teammate workspace.
- Memory graph, sequential thinking, Context7.

A custom server is a name, a command, arguments, and `KEY=value` environment lines. Restrict it to teammate ids or leave that blank for everyone.

Secrets live in `<data>/secrets.json` (mode `0600` where the OS allows). The API lists names only. Tool text that contains a secret of 4+ characters is masked before the model sees it. Child processes do not inherit environment variables whose names look like keys or tokens.

Outward tools (send, write, delete, click, navigate, and unknown names) create an approval and do not run until you approve that exact argument set. The approval is used once. Read-only names run immediately. Watch routines get zero MCP tools.

### Fixture

`gateway/fixtures/mcp-echo.mjs` is a tiny server: `echo` and `get_env` (read), `send_note` (outward). Copy [examples/mcp.fixture.json](examples/mcp.fixture.json) to `gateway/data/mcp.json`. `pnpm dev` runs the gateway with working directory `gateway/`, so the relative `fixtures/mcp-echo.mjs` path resolves. Save a secret named `demo` if you want `get_env` to show a masked token. With `JACKBOT_MODEL=stub`, a message that says "mcp" calls `echo`; a message that says "mcp" and "note" (or send / post / publish) tries `send_note` and stops for approval.

## Develop

```bash
pnpm typecheck
pnpm test
```

Gateway tests are vitest. Web tests are vitest and jsdom. `gateway/test/mcp.test.ts` covers the policy, the fixture process, the approval gate, and that saving the Playwright preset leaves `browser_goto` in place and does not spawn `npx`.

## Gaps

The short list, with the longer one in [docs/grok-bot-parity.md](docs/grok-bot-parity.md):

- No iOS app, no teach-by-demo replay, no HTTP MCP.
- MCP is not inside the teammate container.
- Playwright MCP does not replace the built-in browser.
- Shell and the built-in browser still rely on the model calling `hold_for_approval` before an outward action. MCP outward tools are gated in the gateway.
- Servers that only accept Content-Length requests are not supported. Responses may be newline JSON or Content-Length.
- Workflow files keep the id `opensuperbot.workflow`. Container and image names stay `opensuperbot` so existing computers upgrade in place.
