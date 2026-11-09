/**
 * jackbot reads JACKBOT_* first. Vendored OpenSuperBot and older OpenGrokBot
 * installs keep working: OPENSUPERBOT_* then OPENGROKBOT_*.
 * A blank value does not count, so an empty JACKBOT_MODEL does not hide a
 * real OPENSUPERBOT_MODEL.
 */
export const ENV_PREFIXES = ['JACKBOT_', 'OPENSUPERBOT_', 'OPENGROKBOT_'] as const

export function envRaw(env: Record<string, string | undefined>, suffix: string): string | undefined {
  for (const prefix of ENV_PREFIXES) {
    const value = env[prefix + suffix]
    if (value !== undefined && value.trim() !== '') return value
  }
  return undefined
}

/** The winning variable's full name, for error text. Undefined when none is set. */
export function envSourceName(env: Record<string, string | undefined>, suffix: string): string | undefined {
  for (const prefix of ENV_PREFIXES) {
    const name = prefix + suffix
    const value = env[name]
    if (value !== undefined && value.trim() !== '') return name
  }
  return undefined
}

/** Names set under an older prefix while JACKBOT_* is also set. JACKBOT_* wins. */
export function shadowedByJackbot(env: Record<string, string | undefined>): string[] {
  const shadowed: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.trim() === '') continue
    const suffix = name.startsWith('OPENSUPERBOT_')
      ? name.slice('OPENSUPERBOT_'.length)
      : name.startsWith('OPENGROKBOT_')
        ? name.slice('OPENGROKBOT_'.length)
        : ''
    if (!suffix) continue
    const jack = env['JACKBOT_' + suffix]
    if (jack !== undefined && jack.trim() !== '') shadowed.push(name)
  }
  return shadowed
}
