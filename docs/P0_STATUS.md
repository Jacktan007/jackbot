# jackbot P0 Status (PRD v3 — Offline Scope)

- **Date**: 2026-11-14 (AC-1b / AC-1c updated 2026-11-15)
- **Branch**: `cut-2026-11-14-parity-1`
- **Base**: `main` @ `7a44615`
- **Specs**: `/workspace/cuts/jackbot-PRD-v3.md` (sections 4 & 9), `/workspace/cuts/jackbot切分.md` (AC-1, AC-2)
- **Scope**: AC-1 (offline + CI), AC-2, AC-1b real-key main path (2026-11-15), AC-1c walkthrough findings recorded as known limitations (not fixed this round).

## Summary

| AC | Status | Summary |
| --- | --- | --- |
| **AC-1** | **Partial** (Linux fresh-clone verified; 3-OS CI wired, pending CI run) | Fixed `TS2367` typecheck/build failure in `gateway/src/mcp.ts`, added `smoke:start` production build+start probe (`gateway/scripts/smoke-start.ts`), and wired it into the 3-OS CI matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`) in `.github/workflows/ci.yml`. |
| **AC-1b** | **Done (main path)** | 2026-11-15: real relay key (OpenAI-compatible, model `gpt-6-astra`). Key entered both via env and via the UI settings API with no restart; chat replies, MCP fixture `echo`, and outward `send_note` held for approval. No code change needed. |
| **AC-1c** | **Walkthrough done; findings not fixed** | 2026-11-14 stub-model walkthrough found 7 issues. Per PM scope (2026-11-15, Jack needs main path on 11-16), none fixed this round; all listed as known limitations in `docs/内部试用说明.md`. |
| **AC-2** | **Done** | Audited gateway HTTP MCP implementation (`file:line` citations below), aligned `README.md`, `README.zh-CN.md`, and `docs/grok-bot-parity.md`, and added pinning tests in `gateway/test/mcp.test.ts`. |

---

## AC-1: Fresh-Clone Install, Typecheck, Test, Build+Start, and 3-OS CI

### What Was Done

1. **Fresh-clone baseline reproduction (`/tmp/jb-fresh`, branch `cut-2026-11-14-parity-1` @ `7a44615`)**:
   - `COREPACK_HOME=$HOME/.cache/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile` installed 293 packages with `pnpm v10.33.2`.
   - `pnpm typecheck` failed in `@jackbot/gateway` (`tsc --noEmit -p .`, exit code 1) with two `TS2367` errors in `gateway/src/mcp.ts` (`startWithRetry()` state narrowing across `await`). Because `@jackbot/gateway` `build` runs `tsc -p tsconfig.build.json`, `pnpm build` was blocked by the same error.
   - `pnpm test` passed (`@jackbot/gateway`: 58 files, 675 passed, 3 platform-skipped; `@jackbot/web`: 19 files, 143 passed; total 818 passed, 3 skipped).
2. **Minimal source fix (`gateway/src/mcp.ts:328-357`)**:
   - Added private helpers `currentState()` and `beginAttempt()` on `McpConnection` so TypeScript 7.0.2 re-evaluates `this.state` after `await` boundaries in `startWithRetry()` without runtime changes or type casts.
3. **Production build + start smoke check (`gateway/scripts/smoke-start.ts`, `gateway/package.json:16`)**:
   - Added `pnpm --filter @jackbot/gateway run smoke:start`, which verifies `gateway/dist/main.js` and `web/dist/index.html` exist, binds an unused `127.0.0.1` port, starts `node dist/main.js` in `JACKBOT_MODEL=stub` + `JACKBOT_COMPUTERS=local` mode against an isolated temp `JACKBOT_DATA`, verifies HTTP responses, stops the child process cleanly before removing the temp directory, and checks:
     1. `GET /` returns HTTP `200` (`text/html; charset=utf-8`) with `<div id="root">`.
     2. `GET /api/session` without auth returns HTTP `401`.
     3. `GET /auth?token=...` returns HTTP `302` and sets the `jackbot_session` cookie.
     4. `GET /api/bots` with bearer token returns HTTP `200` and includes seeded teammates (`chief`, `researcher`, `inbox-keeper`, `market-watch`).
4. **Three-platform CI matrix (`.github/workflows/ci.yml:3-48`)**:
   - Added `Start smoke (built gateway and web UI)` (`pnpm --filter @jackbot/gateway run smoke:start`) after `pnpm build` inside `jobs.test`, which runs from a fresh `actions/checkout@v7` on `ubuntu-latest`, `macos-latest`, and `windows-latest`.
   - Enabled workflow triggers for `push` on `[main, 'cut-*']`, `pull_request`, and `workflow_dispatch`.
   - Preserved all existing CI steps and jobs (`Windows start-up scripts parse, install and uninstall`, `local-computer` 3-OS matrix, `audit`, and `bot-image`).

### Evidence (Observed in Fresh Clone `/tmp/jb-fresh` on Linux)

All commands executed with `export COREPACK_HOME="$HOME/.cache/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0`:

- **Before fix (`7a44615`)**:
  - `pnpm install --frozen-lockfile`: exited `0` (`Packages: +293`, `Done in 1.6s using pnpm v10.33.2`).
  - `pnpm typecheck`: exited `1` (`src/mcp.ts(345,9): error TS2367` and `src/mcp.ts(347,9): error TS2367`).
  - `pnpm test`: exited `0` (`@jackbot/gateway`: `Test Files 58 passed (58)`, `Tests 675 passed | 3 skipped (678)`, `6.87s`; `@jackbot/web`: `Test Files 19 passed (19)`, `Tests 143 passed (143)`, `4.87s`). The 3 skipped tests are platform-gated: Windows ACL check (`gateway/test/auth.test.ts:69`) and 2 macOS Seatbelt checks (`gateway/test/sandbox.test.ts:99-140`).
- **After Commits 1–3 (`5e9e6cd`, fresh clone `/tmp/jb-fresh`)**:
  - `pnpm install --frozen-lockfile`: exited `0` (`Packages: +293`, `Done in 1.1s using pnpm v10.33.2`).
  - `pnpm typecheck`: exited `0` (`Done in 512ms`, both `@jackbot/web` and `@jackbot/gateway`).
  - `pnpm test`: exited `0`:
    - `@jackbot/gateway`: `Test Files 58 passed (58)`, `Tests 678 passed | 3 skipped (681)` (`5.65s`).
    - `@jackbot/web`: `Test Files 19 passed (19)`, `Tests 143 passed (143)` (`3.78s`).
    - Total: **821 passed, 3 skipped** across **77 test files**.
  - `pnpm build`: exited `0` (`@jackbot/web` built in `226ms` producing `dist/index.html`, `dist/assets/index-6hv_KiP1.css`, `dist/assets/index-BnZ0iamI.js`; `@jackbot/gateway` compiled via `tsc -p tsconfig.build.json`).
  - `pnpm --filter @jackbot/gateway run smoke:start`: exited `0`, `4/4 checks passed`:
    - `✓ GET / serves built web UI — HTTP 200 (text/html; charset=utf-8)`
    - `✓ GET /api/session rejects unauthenticated requests — HTTP 401`
    - `✓ GET /auth sets session cookie and redirects — HTTP 302`
    - `✓ GET /api/bots returns seeded teammates — HTTP 200; bots=chief, researcher, inbox-keeper, market-watch`

### What Is NOT Done (AC-1)

- **Three-platform CI proof**: `.github/workflows/ci.yml` defines the `ubuntu-latest`, `macos-latest`, and `windows-latest` matrix, and Linux has been verified locally in `/tmp/jb-fresh`. Actual GitHub Actions run logs/screenshots on all three OSes are pending branch push and CI execution (push is out of scope for this task).

---

## AC-1b: Real-Model End-to-End Verification (2026-11-15)

### Setup

- Team relay station (OpenAI-compatible `/v1`, Chat Completions). `GET /v1/models` listed 13 models; `gpt-6-astra` answered, `gpt-6.1-terra` returned `503 Service temporarily unavailable` at test time.
- Key read only from the box env var; never written to the repo, logs or chat. After the run, `grep -F` of the key over both gateway logs, `jackbot.db`/WAL and the repo returned 0 matches. The UI path stores it in `<data>/llm-key` (mode 600).
- Fresh data dirs, `JACKBOT_COMPUTERS=local`, `pnpm dev`.

### Run A: key via environment

`JACKBOT_API_KEY` / `JACKBOT_API_BASE` / `JACKBOT_MODEL=gpt-6-astra`, `examples/mcp.fixture.json` copied to `<data>/mcp.json`.

| Step | Result |
| --- | --- |
| Gateway boot | `listening on 127.0.0.1:4747 · model=gpt-6-astra`, sign-in URL printed |
| Chat (Chief) "你好，用一句话介绍你自己。" | Real reply: 「我是 Chief，你的 AI 幕僚长，负责明确谁做什么、何时完成，只把需要你拍板的事交到你面前。」 |
| MCP fixture `echo` | `mcp_fixture_echo` ok; report 「返回 echo:hello-ac1b」 |
| Outward MCP `send_note` | Model first raised its own approval card; after approve, the gateway gate (`mcp-policy`) raised a second card with `sha256` of the exact args; tool ran only after that approval (`sent:ac1b-test`). |

### Run B: key via the UI settings (non-coder path)

Started with no key (`no model key yet` printed, gateway still boots). Then `POST /api/settings/test` + `PUT /api/settings` (what the 「AI 模型」 dialog calls) with provider `custom`, relay base URL, `gpt-6-astra`, key → test `ok, modelListed: true`, `needsRestart: []`. Next chat turn replied in Chinese immediately without restart.

### Bugs found

- None blocking the main path. UX: outward MCP tools can need two approvals with a real model (model's own card + gateway gate). Listed as a known limitation.

### Spend

About 6 short turns plus 2 direct probes on `gpt-6-astra`; estimated well under ¥1.

### Not covered (out of this round's scope)

Built-in browser navigation, group handoff, routines with the real model.

---

## AC-1c: First-Run UI Walkthrough

### What Was Done

- 2026-11-14 walkthrough of the web UI from sign-in (stub model, screenshots by Bill). Findings below.
- 2026-11-15 scope decision (PM Karpa, relaying Jack): only the install → start → key → chat main path must work for 11-16; all findings go to known limitations, not fixed this round. They are listed in `docs/内部试用说明.md` §5.

| # | Severity | Finding | Classification | Status |
| --- | --- | --- | --- | --- |
| 1 | HIGH | Stub run: "mcp send note" ran `mcp_fixture_send_note` with no approval card | Approval gating. Real-key run (AC-1b) showed the gateway gate holding; the stub discrepancy is not yet explained | Not fixed. Guide warns: do not configure outward MCP connectors yet |
| 2 | HIGH | Routines panel empty with no create control; asking chat for a one-time routine raised an unrelated card to send 4 queued email drafts, no routine created | Routine discoverability + stray approval | Not fixed. Guide: reject that card, don't use routines yet |
| 3 | MED | Stub reply to "hello" claimed work that didn't happen | Stub script wording (stub only) | Not fixed |
| 4 | MED | Computer panel blank when screen WebSocket closed | Missing empty/error state | Not fixed |
| 5 | LOW | Connectors panel says "No connectors yet" while fixture MCP tools run | Label | Not fixed |
| 6 | LOW | favicon 404 | Asset | Not fixed |
| 7 | NOTE | No way to delete a teammate | Missing feature | Not fixed |

Reuse ladder (GEMINI.md §4) for the later fix of #1: reuse the existing `approvals` + `mcp-policy` path first; the open-source comparison (Claude Code / Cline per-tool permission gating) is deferred with the fix.

---

## AC-2: Align HTTP MCP Documentation with Gateway Code

### Code vs. Documentation Comparison (`file:line`)

Previously, `README.md`, `README.zh-CN.md`, and `docs/grok-bot-parity.md` stated that HTTP MCP was not implemented. Inspecting the gateway source established the exact implemented behavior and remaining gaps:

| Aspect | Actual Implementation (`file:line`) |
| --- | --- |
| **Streamable HTTP transport** | `gateway/src/mcp-http.ts:19-65` implements single-endpoint Streamable HTTP (`2025-03-26` `POST` JSON-RPC via `createMcpHttpSession` at lines `37-65`). Sends `content-type: application/json` and `accept: application/json, text/event-stream` (`lines 43-44`), tracks and sends `mcp-session-id` (`lines 46, 50-51`), accepts HTTP `202` for notifications (`lines 53, 61-63`), and parses both JSON and `text/event-stream` SSE `data:` responses matching request `id` (`resultFromHttpBody`, `lines 19-35`). |
| **Config schema & header key constraint** | `gateway/src/mcp-config.ts:13-15, 18, 48-106` allows optional `url` (`http:` or `https:`, `lines 55-63`) with empty `command` (`lines 64-67`). Request headers come from `config.env`, whose keys are validated against `ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/` (`lines 18, 81`), allowing keys like `Authorization` while rejecting hyphenated names like `X-API-Key`. |
| **Lifecycle, secrets, and policy** | `gateway/src/mcp.ts:19, 116-206, 360-391, 486-511, 524-541` substitutes `${secret:name}` in `url` and `env` headers on startup (`lines 361-374`), connects via `createMcpHttpSession` (`line 375`), executes `initialize` (`2024-11-05`), `notifications/initialized`, and `tools/list` (`lines 377-384`), reports `url` in `statuses()` (`line 194`), masks secrets in tool outputs/errors (`lines 200, 535, 539`), excludes watch routines (`lines 117, 149`), and enforces outward-tool approvals (`lines 160-183`; `gateway/src/mcp-policy.ts:24-29`). |
| **API & UI coverage** | `gateway/src/mcp-api.ts:8-13` (`POST /api/mcp/servers`) accepts HTTP configs via `mcp.upsert()`. `gateway/src/mcp-catalog.ts:5-10, 22-154` contains 9 stdio presets only (no HTTP presets). `web/src/components/ConnectorsDialog.tsx:15, 60-67, 111-126, 131-138` and `web/src/api.ts:210-217` list saved HTTP servers with Restart and Delete, while the custom-server form only submits stdio fields (`command` is required). |
| **What is genuinely not implemented** | Z4YT0N HTTP presets (e.g., Vercel), MCP OAuth flows, legacy two-endpoint HTTP+SSE (`GET /sse`), hyphenated HTTP header keys in `env`, a `url` field in the Connectors custom-server form, and `Content-Length`-framed stdio *requests*. |

### What Was Done

1. **Updated documentation**:
   - `docs/grok-bot-parity.md:17, 23, 25`: Replaced the stale "HTTP MCP is not implemented" claim with an exact breakdown of what Streamable HTTP supports and what remains unimplemented.
   - `README.md:17, 98, 114, 131, 137, 141`: Updated upstream table, architecture diagram, Connectors section, test overview, and Gaps list.
   - `README.zh-CN.md:17, 98, 114, 131, 137, 141`: Updated Chinese documentation to match `README.md`.
2. **Added pinning tests (`gateway/test/mcp.test.ts:110-124, 351-492`)**:
   - `validates streamable HTTP server urls and env header keys` (`lines 110-124`).
   - `sends substituted headers, tracks mcp-session-id, masks secrets, and holds outward tools` (`lines 351-461`).
   - `reports missing secrets in streamable HTTP url or header without throwing` (`lines 463-492`).

### Evidence

- `pnpm test` runs `gateway/test/mcp.test.ts` (all Streamable HTTP tests pass; `@jackbot/gateway` total increased from `675 passed | 3 skipped` to `678 passed | 3 skipped`).

### What Is NOT Done (AC-2)

- None.
