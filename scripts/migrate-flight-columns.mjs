import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'

function readEnv(path) {
  const content = readFileSync(path, 'utf8')
  const env = {}
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return env
}

const env = readEnv('.dev.vars')
const url = env.TURSO_DATABASE_URL
const authToken = env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .dev.vars')
}

const client = createClient({ url, authToken })

const migrationSteps = [
  { column: 'leg_type', sql: "ALTER TABLE flights ADD COLUMN leg_type TEXT NOT NULL DEFAULT 'multi'" },
  { column: 'leg_order', sql: "ALTER TABLE flights ADD COLUMN leg_order INTEGER NOT NULL DEFAULT 1" },
  { column: 'from_airport', sql: 'ALTER TABLE flights ADD COLUMN from_airport TEXT' },
  { column: 'to_airport', sql: 'ALTER TABLE flights ADD COLUMN to_airport TEXT' },
]

const tableInfo = await client.execute('PRAGMA table_info(flights)')
const existing = new Set(tableInfo.rows.map((row) => String(row.name)))

for (const step of migrationSteps) {
  if (existing.has(step.column)) {
    console.log(`skip: ${step.column}`)
    continue
  }
  await client.execute(step.sql)
  console.log(`added: ${step.column}`)
}

console.log('done')
