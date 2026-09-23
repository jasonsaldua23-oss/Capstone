import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

type CoverageRecord = {
  id: string
  title: string
  module: string
  layer: string
  result: 'Pass' | 'Fail'
  checks: string[]
  observed: string[]
}

const root = resolve(__dirname, '..', '..')
const evidenceFile = resolve(root, 'test-results', 'alpha-blackbox-contract-evidence.json')
let records = new Map<string, CoverageRecord>()

test.beforeAll(() => {
  // Added: build the evidence once so all 63 Playwright cases inspect the same isolated run.
  execFileSync('python', ['scripts/run_alpha_blackbox_coverage.py'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  const payload = JSON.parse(readFileSync(evidenceFile, 'utf8')) as { cases: CoverageRecord[] }
  records = new Map(payload.cases.map((record) => [record.id, record]))
})

for (let index = 1; index <= 63; index += 1) {
  const id = `TC-${String(index).padStart(2, '0')}`
  test(`${id} documented black-box behavior has an executable automated checkpoint`, async ({}, testInfo) => {
    const record = records.get(id)
    expect(record, `${id} must be present in the coverage evidence`).toBeDefined()
    await testInfo.attach(`${id}-evidence`, {
      body: Buffer.from(JSON.stringify(record, null, 2)),
      contentType: 'application/json',
    })
    expect(record?.checks.length, `${id} must map to at least one executable check`).toBeGreaterThan(0)
    expect(record?.result, record?.observed.join('\n')).toBe('Pass')
  })
}
