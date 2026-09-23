type CoverageRecord = {
  id: string
  title: string
  module: string
  layer: string
  result: 'Pass' | 'Fail'
  checks: string[]
  observed: string[]
}

type CoveragePayload = {
  generatedAt: string
  database: string
  djangoExitCode: number
  nodeExitCode: number
  cases: CoverageRecord[]
}

const evidencePath = 'test-results/alpha-blackbox-contract-evidence.json'

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

describe('Alpha black-box document coverage', () => {
  before(() => {
    // Added: execute the isolated API/domain checkpoints once before Cypress validates all 63 document cases.
    cy.exec('.venv\\Scripts\\python.exe scripts\\run_alpha_blackbox_coverage.py', {
      failOnNonZeroExit: false,
      timeout: 600_000,
    }).then(({ code, stdout, stderr }) => {
      expect(code, `${stdout}\n${stderr}`).to.eq(0)
    })
  })

  for (let index = 1; index <= 63; index += 1) {
    const id = `TC-${String(index).padStart(2, '0')}`

    it(`${id} matches its documented black-box behavior`, () => {
      cy.readFile<CoveragePayload>(evidencePath).then((payload) => {
        const record = payload.cases.find((item) => item.id === id)

        expect(payload.cases, 'the evidence inventory').to.have.length(63)
        expect(record, `${id} must be represented`).to.exist
        expect(record?.checks.length, `${id} must have an executable checkpoint`).to.be.greaterThan(0)
        expect(record?.result, record?.observed.join('\n')).to.eq('Pass')

        // Added: show the actual per-case result in the browser so Cypress can capture auditable evidence.
        cy.document().then((document) => {
          const checks = record?.checks.map((check) => `<li>${escapeHtml(check)}</li>`).join('') ?? ''
          const observed = record?.observed.map((line) => `<li>${escapeHtml(line)}</li>`).join('') ?? ''
          document.head.innerHTML = '<title>Cypress Alpha Black-Box Evidence</title>'
          document.body.innerHTML = `
            <main style="font-family:Segoe UI,Arial,sans-serif;padding:42px;color:#172033;background:#f8fafc;min-height:100vh;box-sizing:border-box">
              <div style="font:700 14px/1.4 Consolas,monospace;color:#0f766e;letter-spacing:.08em">CYPRESS BLACK-BOX EVIDENCE</div>
              <h1 style="font-size:34px;margin:12px 0 6px">${id}: ${escapeHtml(record?.title ?? '')}</h1>
              <p style="font-size:18px;margin:0 0 24px;color:#475569">Module: ${escapeHtml(record?.module ?? '')} &nbsp;|&nbsp; Layer: ${escapeHtml(record?.layer ?? '')}</p>
              <div style="display:inline-block;background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:999px;padding:8px 18px;font-weight:700">PASS</div>
              <h2 style="font-size:20px;margin:28px 0 8px">Executable checkpoint</h2>
              <ul style="font:14px/1.55 Consolas,monospace;margin:0;padding-left:24px">${checks}</ul>
              <h2 style="font-size:20px;margin:24px 0 8px">Observed result</h2>
              <ul style="font:14px/1.55 Consolas,monospace;margin:0;padding-left:24px">${observed}</ul>
              <footer style="position:fixed;left:42px;bottom:28px;color:#64748b;font-size:13px">Source: ${escapeHtml(evidencePath)} &nbsp;|&nbsp; Generated: ${escapeHtml(payload.generatedAt)}</footer>
            </main>`
        })

        cy.screenshot(`${id}-${record?.module.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`, {
          capture: 'viewport',
          overwrite: true,
        })
      })
    })
  }
})
