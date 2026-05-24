import { describeDbTarget } from './db-target-utils.mjs'

const info = describeDbTarget()

console.log(`APP_DB_TARGET: ${info.target}`)
console.log(`Backend database: ${info.label}`)
console.log(`Django alias: ${info.djangoAlias}`)
console.log(`SQLite path: ${info.sqliteDbPath}`)
console.log(`Supabase URL configured: ${info.hasSupabaseUrl ? 'yes' : 'no'}`)
