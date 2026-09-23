import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFPage } from 'pdf-lib'
// @ts-ignore Node's test runner loads this TypeScript source directly.
import { calculateReportColumnWidths, cleanReportPdfColumns, exportReportPdf, exportToCsv, printReportTable } from './export-utils.ts'

test('weighted report columns reserve extra width for dense content', () => {
  assert.deepEqual(
    calculateReportColumnWidths([{ header: 'Reference' }, { header: 'Products', widthWeight: 3 }], 400),
    [100, 300],
  )
})

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
    await exportReportPdf('regression', 'Report', columns, rows, ['Revenue: ₱ 1,000', 'Two', 'Three', 'Fourth summary'])
    assert.ok(download)
    const pdf = await PDFDocument.load(await download!.arrayBuffer())
    assert.ok(pdf.getPageCount() > 2)
    assert.equal(pdf.getPages()[0].getWidth(), 842)
    assert.ok(drawn.includes('Row 60 c7'))
    assert.ok(drawn.includes('Fourth summary'))
    assert.ok(drawn.includes('P'))
    assert.ok(!drawn.includes('PHP'))
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
    assert.ok(html.includes('<colgroup>'))
  } finally {
    globalThis.window = originalWindow
    globalThis.setTimeout = originalTimeout
  }
})

test('purchase-order print uses the same cleaned weighted columns as PDF', () => {
  const originalWindow = globalThis.window
  const originalTimeout = globalThis.setTimeout
  let html = ''
  try {
    globalThis.window = { open: () => ({
      document: { open() {}, write(value: string) { html = value }, close() {} },
      focus() {}, print() {},
    }) } as unknown as Window & typeof globalThis
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout
    printReportTable('Purchase Orders Report', [
      { header: 'PO Number', key: 'poNumber' },
      { header: 'Order Ref', key: 'orderNumber' },
      { header: 'Products', key: 'products', widthWeight: 3 },
    ], [{ poNumber: 'PO-1', orderNumber: 'ORD-1', products: 'Cola 350ml x2' }], ['Total POs: 1'])
    assert.ok(html.includes('<th>Products</th>'))
    assert.ok(!html.includes('<th>Order Ref</th>'))
    assert.ok(html.includes('<th>#</th>'))
    assert.ok(html.includes('class="kpi-strip"'))
  } finally {
    globalThis.window = originalWindow
    globalThis.setTimeout = originalTimeout
  }
})

test('CSV export includes headers, escaped values and every row', async () => {
  const originalDocument = globalThis.document
  const originalCreateUrl = URL.createObjectURL
  const originalRevokeUrl = URL.revokeObjectURL
  let download: Blob | undefined
  let filename = ''
  try {
    globalThis.document = {
      createElement: () => ({
        click() {},
        setAttribute(name: string, value: string) { if (name === 'download') filename = value },
      }),
      body: { appendChild() {}, removeChild() {} },
    } as unknown as Document
    URL.createObjectURL = (blob) => { download = blob as Blob; return 'blob:test-csv' }
    URL.revokeObjectURL = () => {}
    exportToCsv('records', [{ header: 'Name', key: 'name' }], [
      { name: 'First "quoted"\nvalue' },
      { name: 'Second value' },
    ])
    assert.equal(filename, 'records.csv')
    assert.ok(download)
    const csvBytes = new Uint8Array(await download!.arrayBuffer())
    // Fix: Blob.text() removes the BOM, so validate its UTF-8 bytes before decoding the CSV.
    assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
    const csv = new TextDecoder().decode(csvBytes)
    assert.ok(csv.startsWith('"Name"'))
    assert.ok(csv.includes('"First ""quoted""\nvalue"'))
    assert.ok(csv.includes('"Second value"'))
  } finally {
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreateUrl
    URL.revokeObjectURL = originalRevokeUrl
  }
})

test('empty CSV export does not create a download', () => {
  const originalCreateUrl = URL.createObjectURL
  let created = false
  try {
    // Added: an empty report must return before any file or object URL is created.
    URL.createObjectURL = () => { created = true; return 'blob:unexpected' }
    exportToCsv('empty', [{ header: 'Name', key: 'name' }], [])
    assert.equal(created, false)
  } finally {
    URL.createObjectURL = originalCreateUrl
  }
})
