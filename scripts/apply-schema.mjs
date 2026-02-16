import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'

function loadDotEnvFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const map = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const idx = line.indexOf('=')
    if (idx <= 0) {
      continue
    }

    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    map[key] = value
  }

  return map
}

async function main() {
  const root = process.cwd()
  const env = loadDotEnvFile(join(root, '.dev.vars'))

  const url = env.TURSO_DATABASE_URL
  const authToken = env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .dev.vars')
  }

  const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8')
  const client = createClient({ url, authToken })

  await client.batch(
    schema
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => ({ sql: statement })),
    'write',
  )

  const result = await client.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type='table'
      AND name IN ('trips','days','plans','expenses','flights','hotels','app_meta')
    ORDER BY name
  `)

  const names = result.rows.map((row) => String(row.name))
  console.log(`Created/verified tables (${names.length}): ${names.join(', ')}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
