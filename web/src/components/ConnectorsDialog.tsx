import { useEffect, useState } from 'react'
import {
  addMcpPreset, deleteMcpSecret, deleteMcpServer, fetchMcp, restartMcpServer, saveMcpSecret, saveMcpServer,
  type McpSnapshot,
} from '../api'
import { useT } from '../i18n'

/** Add, remove, and restart stdio MCP servers. The teammate computer is unchanged. */
export function ConnectorsDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [snap, setSnap] = useState<McpSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('node')
  const [args, setArgs] = useState('')
  const [envText, setEnvText] = useState('')
  const [bots, setBots] = useState('')
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const load = async () => {
    setError(null)
    try {
      setSnap(await fetchMcp())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.unavailable'))
    }
  }

  useEffect(() => { void load() }, [])

  const run = async (fn: () => Promise<McpSnapshot | { secrets: string[] }>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await fn()
      if ('servers' in next) setSnap(next)
      else setSnap((prev) => prev ? { ...prev, secrets: next.secrets } : prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const env: Record<string, string> = {}
    for (const line of envText.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) {
        setError(t('mcp.field.env'))
        return
      }
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
    }
    void run(async () => {
      const next = await saveMcpServer({
        name: name.trim(),
        command: command.trim(),
        args: args.split('\n').map((line) => line.trim()).filter(Boolean),
        env,
        enabled: true,
        bots: bots.split(',').map((id) => id.trim()).filter(Boolean),
      })
      setName('')
      setArgs('')
      setEnvText('')
      setBots('')
      return next
    })
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="mcp-title">
        <div className="modal-head">
          <div className="modal-title" id="mcp-title">{t('mcp.title')}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="conn-intro">{t('mcp.intro')}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {snap?.configError ? <p className="form-error">{snap.configError}</p> : null}
        {!snap ? <p className="conn-note">{t('mcp.empty')}</p> : null}
        {snap ? (
          <>
            <div className="conn-form-title">{t('mcp.catalog')}</div>
            <div className="conn-list">
              {snap.presets.map((preset) => (
                <div className="conn-card" key={preset.id}>
                  <div className="conn-card-head">
                    <span className="conn-name">{preset.name}</span>
                    <span className="conn-meta">{preset.category}</span>
                  </div>
                  <p className="conn-note">{preset.description}</p>
                  {preset.argHint ? <p className="conn-note">{preset.argHint}</p> : null}
                  {preset.secrets.length > 0 ? (
                    <p className="conn-note">{preset.secrets.map((secret) => `${secret.label}: \${secret:${secret.name}}`).join(' · ')}</p>
                  ) : null}
                  <div className="conn-actions">
                    <button type="button" disabled={busy} onClick={() => void run(() => addMcpPreset(preset.id))}>{t('mcp.add')}</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="conn-form-title">{t('mcp.title')}</div>
            {snap.servers.length === 0 ? <p className="conn-note">{t('mcp.empty')}</p> : null}
            <div className="conn-list">
              {snap.servers.map((server) => (
                <div className="conn-card" key={server.name}>
                  <div className="conn-card-head">
                    <span className="conn-name">{server.name}</span>
                    <span className="conn-badge">{server.state}</span>
                    <span className="conn-meta">{server.toolCount === 1 ? t('mcp.toolsOne') : t('mcp.toolsMany', { count: server.toolCount })}</span>
                  </div>
                  <p className="conn-note">{server.command}</p>
                  <p className="conn-note">{server.bots.length ? t('mcp.forBots', { bots: server.bots.join(', ') }) : t('mcp.allBots')}</p>
                  {server.tools.length > 0 ? <p className="conn-note">{server.tools.join(', ')}</p> : null}
                  {server.error ? <p className="form-error">{server.error}</p> : null}
                  <div className="conn-actions">
                    <button type="button" disabled={busy} onClick={() => void run(() => restartMcpServer(server.name))}>{t('mcp.restart')}</button>
                    <button type="button" className="danger" disabled={busy} onClick={() => void run(() => deleteMcpServer(server.name))}>{t('mcp.delete')}</button>
                  </div>
                </div>
              ))}
            </div>
            <form className="conn-form" onSubmit={(e) => { e.preventDefault(); save() }}>
              <div className="conn-form-title">{t('mcp.custom')}</div>
              <label>{t('mcp.field.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="fixture" /></label>
              <label>{t('mcp.field.command')}<input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></label>
              <label>{t('mcp.field.args')}<textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-memory'} /></label>
              <label>{t('mcp.field.env')}<textarea rows={2} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder={'GITHUB_PERSONAL_ACCESS_TOKEN=${secret:github.token}'} /></label>
              <label>{t('mcp.field.bots')}<input value={bots} onChange={(e) => setBots(e.target.value)} placeholder="researcher" /></label>
              <div className="conn-form-buttons">
                <button type="submit" className="primary" disabled={busy || !name.trim() || !command.trim()}>{t('mcp.save')}</button>
              </div>
            </form>
            <form className="conn-form" onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const next = await saveMcpSecret(secretName.trim(), secretValue)
                setSecretValue('')
                return next
              })
            }}>
              <div className="conn-form-title">{t('mcp.secrets')}</div>
              <p className="conn-note">{t('mcp.secretHint')}</p>
              {snap.secrets.length > 0 ? (
                <div className="conn-list">
                  {snap.secrets.map((secret) => (
                    <div className="conn-card" key={secret}>
                      <div className="conn-card-head">
                        <span className="conn-name">{secret}</span>
                        <button type="button" className="danger" disabled={busy} onClick={() => void run(() => deleteMcpSecret(secret))}>{t('mcp.delete')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <label>{t('mcp.secretName')}<input value={secretName} onChange={(e) => setSecretName(e.target.value)} placeholder="github.token" autoComplete="off" /></label>
              <label>{t('mcp.secretValue')}<input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} autoComplete="off" /></label>
              <div className="conn-form-buttons">
                <button type="submit" className="primary" disabled={busy || !secretName.trim() || !secretValue.trim()}>{t('mcp.secretSave')}</button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </div>
  )
}
