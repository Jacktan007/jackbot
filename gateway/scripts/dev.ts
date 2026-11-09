// pnpm dev 的入口：dev 下界面在 Vite（47821）上，登录链接和「可信来源」都要指向它。
// 放在这里，Windows 的 cmd.exe 和 Unix shell 走同一条路。
if (!process.env.JACKBOT_WEB_URL && !process.env.OPENSUPERBOT_WEB_URL && !process.env.OPENGROKBOT_WEB_URL) {
  process.env.JACKBOT_WEB_URL = 'http://127.0.0.1:47821'
}
await import('../src/main.js')
