// 生产构建冒烟：启动打包后的 gateway + web/dist（stub + local 模式），验证 4 项基础响应后退出并清理临时目录。
// 跑法：pnpm build && pnpm --filter @jackbot/gateway run smoke:start
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = 'smoke-start-ephemeral-0123456789abcdef'
const gatewayDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(gatewayDir, '..')
const mainJs = join(gatewayDir, 'dist', 'main.js')
const webIndex = join(repoRoot, 'web', 'dist', 'index.html')

if (!existsSync(mainJs)) {
  console.error(`Missing ${mainJs}. Run "pnpm build" first.`)
  process.exit(1)
}
if (!existsSync(webIndex)) {
  console.error(`Missing ${webIndex}. Run "pnpm build" first.`)
  process.exit(1)
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('failed to determine free port')))
        return
      }
      const { port } = addr
      srv.close((err) => (err ? reject(err) : resolvePort(port)))
    })
  })
}

const port = await getFreePort()
const base = `http://127.0.0.1:${port}`
const dataDir = await mkdtemp(join(tmpdir(), 'jb-smoke-start-'))

const checks: { name: string; ok: boolean }[] = []
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

let outputTail = ''
const appendOutput = (chunk: Buffer | string) => {
  outputTail = (outputTail + String(chunk)).slice(-2000)
}

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: gatewayDir,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    JACKBOT_MODEL: 'stub',
    JACKBOT_COMPUTERS: 'local',
    JACKBOT_HOST: '127.0.0.1',
    JACKBOT_PORT: String(port),
    JACKBOT_DATA: dataDir,
    JACKBOT_DB: join(dataDir, 'jackbot.db'),
    JACKBOT_TOKEN: TOKEN,
    JACKBOT_QUIET_TOKEN: '1',
    JACKBOT_WEB_URL: base,
  },
})

child.stdout.on('data', appendOutput)
child.stderr.on('data', appendOutput)

let exited = false
let exitInfo = ''
const closed = new Promise<void>((resolveClosed) => {
  child.once('close', (code, signal) => {
    exited = true
    exitInfo = `code=${code ?? 'null'} signal=${signal ?? 'null'}`
    resolveClosed()
  })
})

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`gateway exited early (${exitInfo})\n${outputTail}`)
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) })
      if (res.status === 200) return
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`gateway did not respond on ${base} within 15s\n${outputTail}`)
}

async function stopChild(): Promise<void> {
  if (!exited) {
    try {
      child.kill()
    } catch {
      // Already exiting.
    }
    const forceTimer = setTimeout(() => {
      if (!exited) {
        try {
          child.kill('SIGKILL')
        } catch {
          // Ignore.
        }
      }
    }, 5_000)
    await Promise.race([
      closed,
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 7_000)),
    ])
    clearTimeout(forceTimer)
  }
  child.stdout.destroy()
  child.stderr.destroy()
}

try {
  await waitForServer()

  const rootRes = await fetch(`${base}/`)
  const rootType = rootRes.headers.get('content-type') ?? ''
  const rootBody = await rootRes.text()
  check(
    'GET / serves built web UI',
    rootRes.status === 200 && rootType.includes('text/html') && rootBody.includes('<div id="root">'),
    `HTTP ${rootRes.status} (${rootType})`,
  )

  const unauthRes = await fetch(`${base}/api/session`)
  check('GET /api/session rejects unauthenticated requests', unauthRes.status === 401, `HTTP ${unauthRes.status}`)

  const authRes = await fetch(`${base}/auth?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  const setCookie = authRes.headers.get('set-cookie') ?? ''
  check(
    'GET /auth sets session cookie and redirects',
    authRes.status === 302 && setCookie.includes('jackbot_session='),
    `HTTP ${authRes.status}`,
  )

  const botsRes = await fetch(`${base}/api/bots`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const bots = botsRes.ok ? (await botsRes.json() as Array<{ id?: string }>) : []
  const ids = Array.isArray(bots) ? bots.map((b) => b.id).filter(Boolean) : []
  check(
    'GET /api/bots returns seeded teammates',
    botsRes.status === 200 && ids.includes('chief') && ids.includes('researcher'),
    `HTTP ${botsRes.status}; bots=${ids.join(', ')}`,
  )
} finally {
  await stopChild()
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) {
  console.error(`${failed.length} check(s) failed`)
  process.exit(1)
}
