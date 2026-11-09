import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseComputerChoice, type ComputerChoice } from './backend.js'
import { envRaw } from './env-names.js'

/** 模型接口的说法：chat = OpenAI 兼容的 Chat Completions；anthropic = Claude 的 Messages；responses = OpenAI 的 Responses */
export type LlmApi = 'chat' | 'anthropic' | 'responses'

export type Config = {
  /** 同事的电脑是什么做的：auto = 有 Docker 用 Docker，否则本机模式 */
  computers: ComputerChoice
  /** 本机模式用的浏览器可执行文件；空 = 自己找（Chrome/Edge/…），找不到就下载 */
  browser: string
  /** 下载浏览器时给 playwright 的镜像主机；空 = 官方 */
  browserMirror: string
  baseURL: string
  apiKey: string
  model: string
  /** 所选服务商要额外带的请求字段（预设里来，见 providers.ts）；环境变量配的为空 */
  extraBody: Record<string, unknown>
  /** 走哪种接口；环境变量配的一律是 OpenAI 兼容（老行为） */
  api: LlmApi
  /** 默认只听本机回环：局域网里的设备碰不到网关 */
  host: string
  port: number
  dataDir: string
  dbPath: string
  teammatesDir: string
  /** 构建好的前端；存在就由网关直接托管，一个端口搞定 */
  webDist: string
  /** 登录链接用的前端地址（dev 下是 Vite 的 5173）；空 = 网关自己 */
  webUrl: string
  chiefId: string
  a2aAllow: string
  groupId: string
  groupTitle: string
  /** 固定网关令牌；空 = 用数据目录里自动生成的那个 */
  token: string
  /** 反代等场景下 Host 与 Origin 对不上时，额外放行的来源 */
  allowedOrigins: string[]
  llmTimeoutMs: number
  llmRetries: number
  /** 每个 bot 每天的 token 上限；0 = 不限 */
  dailyTokens: number
  /** 把截图喂回模型（需要支持图片输入的模型） */
  vision: boolean
  /** 电脑空闲多少分钟后停机；0 = 永不 */
  idleStopMinutes: number
  botMemoryMb: number
  botCpus: number
  timeZone: string
  /** 一个回合最多调几次模型 */
  maxSteps: number
  /** 一个回合最长几分钟；0 = 不限 */
  turnMinutes: number
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function flag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())
}

/** 改名为 OpenSuperBot 之前，变量都叫 OPENGROKBOT_*：老的 launchd / systemd / 计划任务配置里还写着它们 */
const LEGACY_ENV_PREFIX = 'OPENGROKBOT_'
const ENV_PREFIX = 'OPENSUPERBOT_'

/**
 * 老名字照样生效：新名字没设时，用老名字的值顶上（直接写回 env，读环境变量的地方就都不用管改名）。
 * 两个都设了以新的为准。返回用上的和被盖住的老名字，好让启动日志提醒一句；值本身不往外报（里面有 key）。
 */
export function adoptLegacyEnv(env: Record<string, string | undefined>): { adopted: string[]; shadowed: string[] } {
  const adopted: string[] = []
  const shadowed: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue
    const current = ENV_PREFIX + name.slice(LEGACY_ENV_PREFIX.length)
    if (env[current] === undefined) {
      env[current] = value
      adopted.push(name)
    } else {
      shadowed.push(name)
    }
  }
  return { adopted, shadowed }
}

/**
 * 新库叫 jackbot.db。已经在用的 opensuperbot.db / opengrokbot.db 接着用，不搬文件。
 */
export function defaultDbPath(dataDir: string, exists: (path: string) => boolean = existsSync): string {
  const jack = join(dataDir, 'jackbot.db')
  const current = join(dataDir, 'opensuperbot.db')
  const legacy = join(dataDir, 'opengrokbot.db')
  if (exists(jack)) return jack
  if (exists(current)) return current
  if (exists(legacy)) return legacy
  return jack
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // JACKBOT_* wins, then OPENSUPERBOT_*, then OPENGROKBOT_*.
  const raw = (suffix: string) => envRaw(env, suffix)
  // 一律转成绝对路径：相对路径传给 docker 的 bind 会被当成卷名直接报错
  const dataDir = resolve(raw('DATA') || fileURLToPath(new URL('../data', import.meta.url)))
  const db = raw('DB')
  return {
    baseURL: raw('API_BASE') || 'https://api.x.ai/v1',
    apiKey: raw('API_KEY') || '',
    model: raw('MODEL') || 'grok-4.7',
    extraBody: {},
    api: 'chat',
    computers: parseComputerChoice(raw('COMPUTERS')),
    browser: (raw('BROWSER') || '').trim(),
    browserMirror: (raw('BROWSER_MIRROR') || '').trim(),
    host: raw('HOST') || '127.0.0.1',
    port: num(raw('PORT'), 4747),
    dataDir,
    dbPath: db === ':memory:' ? ':memory:' : resolve(db || defaultDbPath(dataDir)),
    teammatesDir: raw('TEAMMATES') || fileURLToPath(new URL('../../teammates', import.meta.url)),
    webDist: raw('WEB_DIST') || fileURLToPath(new URL('../../web/dist', import.meta.url)),
    webUrl: (raw('WEB_URL') || '').replace(/\/$/, ''),
    chiefId: raw('CHIEF') || 'chief',
    // 同级互发默认关闭：`researcher>market-watch,market-watch>researcher`
    a2aAllow: raw('A2A_ALLOW') || '',
    groupId: raw('GROUP_ID') || 'group:offsite-crew',
    groupTitle: raw('GROUP_TITLE') || 'Offsite crew',
    token: (raw('TOKEN') || '').trim(),
    allowedOrigins: (raw('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean),
    llmTimeoutMs: num(raw('LLM_TIMEOUT_MS'), 120_000),
    llmRetries: num(raw('LLM_RETRIES'), 2),
    dailyTokens: num(raw('DAILY_TOKENS'), 0),
    vision: flag(raw('VISION')),
    idleStopMinutes: num(raw('IDLE_STOP_MINUTES'), 60),
    botMemoryMb: num(raw('BOT_MEMORY_MB'), 2048),
    botCpus: num(raw('BOT_CPUS'), 2),
    timeZone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    maxSteps: num(raw('MAX_STEPS'), 40) || 40,
    turnMinutes: num(raw('TURN_MINUTES'), 20),
  }
}
