import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFPage } from 'pdf-lib'
// @ts-ignore Node's test runner loads this TypeScript source directly.
import { cleanReportPdfColumns, exportReportPdf, printReportTable } from './export-utils.ts'

test('PDF column cleanup removes redundant purchase document fields', () => {
  const columns = ['PO Number', 'PR Ref', 'Order Ref', 'Client', 'PO Stage', 'Created Date'].map((header) => ({ header }))
  assert.deepEqual(
    cleanReportPdfColumns('Purchase Orders Report', columns).map((column) => column.header),
    ['PO Number', 'PR Ref', 'Client', 'PO Stage'],
  )
})

// Regression: exercise the real PDF renderer while capturing its browser download.
test('PDF retains rows, columns and long cell values across pages', async () => {
  const originalDocument = globalThis.document
  const originalCreateUrl = URL.createObjectURL
  const originalRevokeUrl = URL.revokeObjectURL
  const originalDrawText = PDFPage.prototype.drawText
  const drawn: string[] = []
  let download: Blob | undefined
  try {
    globalThis.document = {
      createElement: () => ({ click() {} }),
      body: { appendChild() {}, removeChild() {} },
    } as unknown as Document
    URL.createObjectURL = (blob) => { download = blob as Blob; return 'blob:test' }
    URL.revokeObjectURL = () => {}
    PDFPage.prototype.drawText = function (text, options) {
      drawn.push(text)
      assert.ok((options?.y ?? 0) >= 30)
      if (options?.font && options.size) {
        assert.ok((options.x || 0) + options.font.widthOfTextAtSize(text, options.size) <= this.getWidth() - 30)
      }
      return originalDrawText.call(this, text, options)
    }
    const columns = Array.from({ length: 8 }, (_, i) => ({ header: `Column ${i}`, key: `c${i}` }))
    const rows = Array.from({ length: 61 }, (_, i) => Object.fromEntries(columns.map((col) => [col.key, `Row ${i} ${col.key}`])))
    rows[0].c0 = 'LONG_IDENTIFIER_'.repeat(400)
    await exportReportPdf('regression', 'Report', columns, rows, ['One', 'Two', 'Three', 'Fourth summary'])
    assert.ok(download)
    const pdf = await PDFDocument.load(await download!.arrayBuffer())
    assert.ok(pdf.getPageCount() > 2)
    assert.equal(pdf.getPages()[0].getWidth(), 842)
    assert.ok(drawn.includes('Row 60 c7'))
    assert.ok(drawn.includes('Fourth summary'))
    assert.equal(drawn.filter((text) => text === 'Column 7').length, pdf.getPageCount())
    assert.equal(drawn.filter((text) => /^[LONG_IDENTIFIER_]+$/.test(text)).join(''), rows[0].c0)
  } finally {
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreateUrl
    URL.revokeObjectURL = originalRevokeUrl
    PDFPage.prototype.drawText = originalDrawText
  }
})

test('print includes records after 500 and escapes literal HTML', () => {
  const originalWindow = globalThis.window
  const originalTimeout = globalThis.setTimeout
  let html = ''
  try {
    globalThis.window = { open: () => ({
      document: { open() {}, write(value: string) { html = value }, close() {} },
      focus() {}, print() {},
    }) } as unknown as Window & typeof globalThis
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
    printReportTable('<Report>', [{ header: 'Name', key: 'name' }],
      Array.from({ length: 501 }, (_, i) => ({ name: `Record ${i} & <literal>` })), ['<Summary>'])
    assert.ok(html.includes('Record 500 &amp; &lt;literal&gt;'))
    assert.ok(html.includes('&lt;Summary&gt;'))
    assert.ok(html.includes('table-header-group'))
    assert.ok(html.includes('table-layout: fixed'))
  } finally {
    globalThis.window = originalWindow
    globalThis.setTimeout = originalTimeout
  }
})
