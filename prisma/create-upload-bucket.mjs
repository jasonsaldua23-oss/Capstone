import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(filePath) {
  const env = {}
  const content = readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function main() {
  const bucketName = process.argv[2] || process.env.SUPABASE_UPLOADS_BUCKET || 'uploads'
  const envPath = resolve(process.cwd(), '.env')
  const env = loadEnvFile(envPath)

  const url = process.env.SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE ||
    env.SUPABASE_SERVICE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  }

  const response = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: bucketName,
      public: true,
    }),
  })

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 409 || /already exists/i.test(text)) {
      console.log(`Bucket ${bucketName} already exists.`)
      return
    }

    throw new Error(`Failed to create bucket: ${response.status} ${text}`)
  }

  console.log(`Created Supabase bucket ${bucketName}.`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})