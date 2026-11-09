# jackbot and Grok Bot

jackbot is a self-hosted workspace in the same shape as xAI / Cursor Grok Bot: one gateway, one computer per teammate, a thread the operator actually works in, and connectors beside that computer. It is not Grok Bot. There is no private Grok Bot API in this repo. You bring an OpenAI-compatible key (xAI's API is the default base URL) or run the offline stub.

The computer, threads, approvals, memory, and routines come from [OpenSuperBot](https://github.com/wolfqing/OpenSuperBot) (MIT; the project was OpenGrokBot until November 2026). The MCP client and the Playwright / Chrome DevTools presets follow [nickylin/OpenGrokBot](https://github.com/nickylin/OpenGrokBot) (MIT). The extra stdio presets follow the marketplace list in [Z4YT0N/OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot) (MIT). Those two apps use CLI harnesses (Claude Code, Codex, Cursor CLI) as the "employee". jackbot does not. The teammate computer stays the OpenSuperBot one: a real Chromium plus a folder, in Docker or on the host.

## What lines up

| Grok Bot idea | jackbot |
| --- | --- |
| A bot with its own computer | Default. Docker image `opensuperbot/bot:dev`, or a local Chromium profile and a sandboxed folder. Shell, files, and `browser_goto` / extract / click / type / screenshot. |
| A thread with the operator | Web UI. DMs, group threads, handoffs between teammates. |
| Ask before something leaves | `hold_for_approval` for mail, posts, and payments, plus standing rules. MCP tools that can send, write, or delete are held until you approve that exact call. |
| Memory | Per-teammate `MEMORY.md`. Save and forget are operator-turn only. |
| Routines | Cron and webhooks. A watch routine only gets the computer's read-only tools, never MCP. |
| Your own model key | `JACKBOT_API_KEY`, `JACKBOT_API_BASE`, `JACKBOT_MODEL`. Any OpenAI-compatible server, including `https://api.x.ai/v1`. Per-teammate connections in the AI dialog. |
| Connectors / MCP | First-class tools named `mcp_<server>_<tool>`, configured in Connectors or `<data>/mcp.json`. `${secret:name}` from `<data>/secrets.json`. |
| Offline demo | `JACKBOT_MODEL=stub`. No network. The stub drives the browser and the fixture connector. |

## Honest gaps

- **Not Grok Bot.** No iOS app, no hosted Grok Bot account, no teach-by-demo replay, no proprietary tool API.
- **MCP runs on the gateway machine**, as the user who started the gateway. It is not inside the teammate container and does not share that container's filesystem sandbox. Treat a connector as another process on the host.
- **The built-in browser is still the computer's Chromium.** The Playwright and Chrome DevTools presets are extra browsers with their own profiles. Adding a preset only writes config. Nothing is downloaded until you Restart, or until a turn needs that server's tools.
- **HTTP MCP is not implemented.** The Vercel-style HTTP connector from the Z4 catalog is omitted. This client speaks newline-delimited JSON-RPC (`2024-11-05`) and also accepts Content-Length responses. A server that accepts only Content-Length *requests* will not work.
- **Outward MCP calls are gated in code.** Shell and the built-in browser are not: those outward actions are still the model's `hold_for_approval` discipline, the same as OpenSuperBot. A prompt can still ask the computer to do something you did not approve.
- **Read vs outward is a name heuristic.** Unknown tool names are held. A badly named read can be held; a badly named send that only matches a read pattern can run. Watch routines get no MCP tools, so a background watch cannot fire a misclassified one.
- **One approval runs once**, and only with the same arguments. A later call needs a new approval.
- **Secrets** are masked when they show up in tool text (values of 4 characters or more). A tool that transforms the secret before echoing it can still leak it. Child processes do not inherit env vars whose names contain `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `COOKIE`, or `AUTH`.
- **Docker names stay upstream** so existing computers keep working: image `opensuperbot/bot:dev`, containers `opensuperbot-<id>`, network `opensuperbot-bots`. The workflow file format id stays `opensuperbot.workflow`.
- **Session cookies.** Login sets `jackbot_session` and `osb_session`. `ogb_session` is still accepted. Webhooks accept `X-Jackbot-Key`, then `X-OpenSuperBot-Key`, then `X-OpenGrokBot-Key`.
