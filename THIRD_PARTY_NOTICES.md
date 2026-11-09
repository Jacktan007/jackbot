# Third-party notices

jackbot is MIT licensed. See [LICENSE](LICENSE). The copyright lines there cover this tree and the upstreams it vendors.

## OpenSuperBot

<https://github.com/wolfqing/OpenSuperBot>

MIT License. Copyright (c) 2026 wolfqing and OpenSuperBot contributors.

The gateway, the web UI, the per-teammate computer (Docker and local Chromium), approvals, memory, routines, and the stub model are from this project. It was named OpenGrokBot before November 2026. jackbot keeps those compatibility names: `OPENSUPERBOT_*` and `OPENGROKBOT_*` environment variables, the `osb_session` and `ogb_session` cookies, the webhook headers `X-OpenSuperBot-Key` and `X-OpenGrokBot-Key`, the database filenames `opensuperbot.db` and `opengrokbot.db`, the container image `opensuperbot/bot:dev`, and the workflow format id `opensuperbot.workflow`.

## nickylin/OpenGrokBot

<https://github.com/nickylin/OpenGrokBot>

MIT License. Copyright (c) 2026 nickylin.

The stdio MCP session (newline JSON-RPC, protocol `2024-11-05`), `${secret:name}` substitution, and the Playwright MCP / Chrome DevTools MCP presets follow this project. jackbot does not include its CLI harnesses. The client lives in `gateway/src/mcp.ts`, `gateway/src/secrets.ts`, and `gateway/src/mcp-catalog.ts`.

## Z4YT0N/OpenGrokBot

<https://github.com/Z4YT0N/OpenGrokBot>

MIT License. Copyright (c) 2026 Mahmoud Amr (FortuneCode).

The extra stdio preset names (GitHub, filesystem, memory, sequential thinking, Context7, Slack, Notion) follow that project's marketplace list. jackbot does not include its CLI employees or its HTTP MCP connectors.
