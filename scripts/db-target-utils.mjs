import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const repoRoot = resolve(__dirname, '..')
export const envPath = resolve(repoRoot, '.env')

export function normalizeDbTarget(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (['supa', 'supabase', 'postgres', 'postgresql'].includes(raw)) return 'supa'
  return ''
}

export function parseSimpleEnv(source) {
  const values = {}
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    let [, key, value] = match
    value = value.trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }
  return values
}

export function loadRepoEnv() {
  if (!existsSync(envPath)) return {}
  return parseSimpleEnv(readFileSync(envPath, 'utf8'))
}

export function resolveDbTarget() {
  const envValues = loadRepoEnv()
  const explicitTarget =
    normalizeDbTarget(process.env.APP_DB_TARGET) ||
    normalizeDbTarget(envValues.APP_DB_TARGET)

  if (explicitTarget) return explicitTarget

  const databaseUrl = String(process.env.DATABASE_URL ?? envValues.DATABASE_URL ?? '').trim()
  return databaseUrl ? 'supa' : ''
}

export function describeDbTarget(target = resolveDbTarget()) {
  const envValues = loadRepoEnv()

  return {
    target,
    label: target === 'supa' ? 'Supabase/Postgres' : 'Not configured',
    djangoAlias: target === 'supa' ? 'supabase' : 'unknown',
    hasSupabaseUrl: Boolean(String(envValues.DATABASE_URL || '').trim()),
  }
}
