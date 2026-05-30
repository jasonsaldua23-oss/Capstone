import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { envPath, normalizeDbTarget, repoRoot } from './db-target-utils.mjs'

const requestedTarget = normalizeDbTarget(process.argv[2])

if (requestedTarget !== 'supa') {
  console.error('Usage: node scripts/set-db-target.mjs supa')
  process.exit(1)
}

const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const nextValues = {
  APP_DB_TARGET: requestedTarget,
}

function upsertEnvValue(source, key, value) {
  const line = `${key}="${value}"`
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm')

  if (pattern.test(source)) {
    return source.replace(pattern, line)
  }

  const trimmed = source.trimEnd()
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`
}

let updated = current
for (const [key, value] of Object.entries(nextValues)) {
  updated = upsertEnvValue(updated, key, value)
}

writeFileSync(envPath, updated)

console.log(`Database target set to '${requestedTarget}' in ${envPath}`)
console.log('')
console.log('Next steps:')
console.log('- Restart the Django backend if it is running.')
console.log('- Restart Next.js if you want the UI to reconnect to a freshly restarted backend.')
console.log(`- Repo root: ${repoRoot}`)
