# jackbot

致谢与来源：网关、线程界面和每位同事的电脑来自 wolfqing 的 [OpenSuperBot](https://github.com/wolfqing/OpenSuperBot)（MIT，原名 OpenGrokBot）。stdio MCP 客户端沿用 [nickylin/OpenGrokBot](https://github.com/nickylin/OpenGrokBot)（MIT）。其余 stdio 预设沿用 Mahmoud Amr 的 [Z4YT0N/OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot)（MIT）。

自托管的同事，每位同事一台自己的电脑。用你自己的 API key。

jackbot 是一个网关、一套线程界面，以及每位同事一台电脑：真正的 Chromium、一个文件夹、一个 shell。审批、记忆、例行任务和群里转交都走这条路。MCP 连接器是电脑旁边的额外工具，不换掉电脑。

这是本仓库里最接近 xAI / Cursor Grok Bot 这种形态的开源实现。它不是 Grok Bot，也不调用任何私有的 Grok Bot 接口。对照和缺口见 [docs/grok-bot-parity.md](docs/grok-bot-parity.md)。English: [README.md](README.md).

## 代码从哪来

| 部分 | 上游 | jackbot 留下什么 |
| --- | --- | --- |
| 网关、网页、每人一台电脑、审批、记忆、例行任务 | [wolfqing/OpenSuperBot](https://github.com/wolfqing/OpenSuperBot)（MIT），2026 年 11 月前叫 OpenGrokBot | 整个产品，这是底座 |
| stdio MCP 客户端、`${secret:}` 密钥库、Playwright 与 Chrome DevTools 预设 | [nickylin/OpenGrokBot](https://github.com/nickylin/OpenGrokBot)（MIT） | 客户端和这两个预设，做进网关。不带那个项目的 CLI 套件 |
| 其余 stdio 预设 | [Z4YT0N/OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot) 的市场列表（MIT） | GitHub、文件系统、记忆图、逐步思考、Context7、Slack、Notion。不带 CLI 员工，也没有 HTTP MCP |

许可：[LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 快速开始

需要 Node.js 22+ 和 pnpm 10。

1. `pnpm install`
2. 不配 key、离线跑：`JACKBOT_MODEL=stub pnpm dev`
3. 打开终端里那条登录链接。界面是 <http://127.0.0.1:47821>，网关是 <http://127.0.0.1:4747>。没有这条链接时 `/api/session` 是 401。令牌文件是 `gateway/data/auth-token`。

要用真实模型，先设 key。没设 `JACKBOT_MODEL=stub` 也没设 key 时，网关会提示并照常启动，但回合打不到模型：

```bash
export JACKBOT_API_KEY="你的 key"
export JACKBOT_API_BASE="https://api.x.ai/v1"   # 或 http://localhost:11434/v1
export JACKBOT_MODEL="grok-4.7"
pnpm dev
```

`JACKBOT_*` 优先。空白不会盖住 `OPENSUPERBOT_*` 和 `OPENGROKBOT_*`。

## 跑起来

需要 Node.js 22+ 和 pnpm 10。

```bash
pnpm install
JACKBOT_MODEL=stub pnpm dev
```

- 界面：<http://127.0.0.1:47821>
- 网关：<http://127.0.0.1:4747>（界面会代理过去）
- 终端会打出登录链接。令牌文件是 `gateway/data/auth-token`。不带这个链接打开界面时，`/api/session` 返回 401。

`JACKBOT_MODEL=stub` 是脚本模型，不需要 key，也不上网。消息里有 URL，stub 会用 `browser_goto` 打开。消息里有 “mcp” 或 “connector”，而且配了下面的 fixture，它会去调那些工具。

真实模型，任何 OpenAI 兼容服务（默认基址是 xAI）：

```bash
export JACKBOT_API_KEY="你的 key"
export JACKBOT_API_BASE="https://api.x.ai/v1"   # 或 http://localhost:11434/v1，或其他 /v1
export JACKBOT_MODEL="grok-4.7"
pnpm dev
```

生产构建：`pnpm build`，然后 `pnpm start`。网关会托管 `web/dist`。

### 环境变量

`JACKBOT_*` 优先。这个名字没设或是空白时，用 `OPENSUPERBOT_*`，再没有才用 `OPENGROKBOT_*`。空白不算数，不会盖住旧名字上的真实值。

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `JACKBOT_API_KEY` | 模型 key | 空 |
| `JACKBOT_API_BASE` | OpenAI 兼容基址 | `https://api.x.ai/v1` |
| `JACKBOT_MODEL` | 模型 id。`stub` 是离线模型 | `grok-4.7` |
| `JACKBOT_DATA` | 数据目录（库、令牌、mcp.json、密钥） | `gateway/data` |
| `JACKBOT_PORT` | 网关端口 | `4747` |
| `JACKBOT_HOST` | 网关监听地址 | `127.0.0.1` |
| `JACKBOT_WEB_URL` | 登录链接用的界面地址 | 开发时 `http://127.0.0.1:47821` |
| `JACKBOT_COMPUTERS` | `auto`、`docker` 或 `local` | `auto` |
| `JACKBOT_BROWSER` | 本机电脑用的 Chromium | 自己找，找不到再下载 |
| `JACKBOT_DAILY_TOKENS` | 每位同事每天的 token 上限 | 不限 |
| `JACKBOT_TOKEN` | 用固定网关令牌，不写文件 | 数据目录里的文件 |

数据库文件是 `jackbot.db`。目录里还没有它、但有 `opensuperbot.db` 或 `opengrokbot.db` 时，继续用旧文件。

Docker 电脑的镜像仍是 `opensuperbot/bot:dev`，容器名是 `opensuperbot-<id>`。要 Docker 而不是本机浏览器时，用 `computer/` 里的上游 Dockerfile 构建。`JACKBOT_COMPUTERS=local` 则跳过 Docker。

## 结构

```
浏览器 → Vite 界面 :47821 → 网关 :4747 → 模型（你的 key，或 stub）
                              │
                              ├─ 每位同事一台电脑
                              │    Docker（opensuperbot/bot:dev）或本机 Chromium + 文件夹
                              │    shell、文件、browser_goto / extract / click / screenshot
                              │
                              └─ MCP 服务器，跑在网关这台机器上
                                   stdio JSON-RPC，工具名 mcp_<服务器>_<工具>
```

网关是 Hono + SQLite（`@jackbot/gateway`）。界面是 React + Vite（`@jackbot/web`）。一轮对话先放上这位同事自己的工具，再附上他能用的 MCP 工具。watch 例行任务只有电脑上的只读工具。

MCP 由启动网关的用户在宿主机上拉起，不在同事的容器里。这是隔离上的缺口，详见对照文档。

## 连接器

侧栏里的 **MCP**（`/api/mcp` 可用时才出现）。预设：

- Playwright 和 Chrome DevTools，各自一套配置目录。这是另一套浏览器。同事的电脑和登录状态不动。保存预设不会下载任何东西。等你点重启，或下一轮真的要用这些工具，才会跑 `npx`。
- GitHub、Slack、Notion。令牌放进密钥库（对话框里写的 `${secret:github.token}` 等）。
- 文件系统。默认是数据目录下的空文件夹，不是某位同事的工作区。
- 记忆图、逐步思考、Context7。

自定义服务器填名字、命令、参数，以及一行一个 `KEY=value`。可以限定同事 id，留空就是每位同事都能用。

密钥在 `<data>/secrets.json`（系统允许时是 `0600`）。接口只返回名字。工具原文里出现长度不少于 4 的密钥时，模型看到之前会被打码。子进程不会继承名字里像 key、token 的环境变量。

会往外发送、写入、删除、点击、导航的工具，以及叫不上名字的工具，会先建一条审批，参数必须完全一致才执行。一次审批只用一次。只读名字会立刻跑。watch 例行任务拿不到任何 MCP 工具。

### Fixture

`gateway/fixtures/mcp-echo.mjs` 是个很小的服务器：`echo` 和 `get_env`（只读），`send_note`（往外）。把 [examples/mcp.fixture.json](examples/mcp.fixture.json) 复制成 `gateway/data/mcp.json`。`pnpm dev` 时网关的工作目录是 `gateway/`，所以相对路径 `fixtures/mcp-echo.mjs` 能找到。想让 `get_env` 显示打过码的令牌，先存一个叫 `demo` 的密钥。`JACKBOT_MODEL=stub` 时，消息里有 “mcp” 会调 `echo`；还有 “note”（或 send / post / publish）会试 `send_note`，然后停下来等批准。

## 开发

```bash
pnpm typecheck
pnpm test
```

网关测试是 vitest。网页测试是 vitest + jsdom。`gateway/test/mcp.test.ts` 覆盖策略、fixture 进程、审批门，以及保存 Playwright 预设之后 `browser_goto` 还在、并且不会去拉起 `npx`。

## 缺口

长的一版在 [docs/grok-bot-parity.md](docs/grok-bot-parity.md)。短的：

- 没有 iOS，没有手把手演示回放，没有 HTTP MCP。
- MCP 不在同事的容器里。
- Playwright MCP 不替换内置浏览器。
- shell 和内置浏览器的对外动作，仍然靠模型去调 `hold_for_approval`。MCP 的对外工具由网关拦住。
- 只接受 Content-Length 请求的服务器不支持。响应可以是换行 JSON，也可以是 Content-Length。
- 工作流文件的 id 仍是 `opensuperbot.workflow`。容器和镜像名仍是 `opensuperbot`，这样已有的电脑可以原地升级。
