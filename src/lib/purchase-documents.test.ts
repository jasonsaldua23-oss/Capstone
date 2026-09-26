import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCustomerOrderNote,
  getPurchaseDocumentAmount,
  getPurchaseOrderDate,
  getPurchaseOrderDeliveryDate,
  getPurchaseOrderStage,
  getPurchaseRequestStatus,
  isPurchaseRequestDocument,
  matchesPurchaseDatePreset,
  toPurchaseRequestRecord,
} from './purchase-documents'

test('an approved PR reads its locked snapshot, not the live PO transaction', () => {
  const transaction = {
    id: 'tx-1',
    orderNumber: 'PO-2026-0001',
    totalAmount: 1500,
    amountDue: 1620,
    emptiesAdjustment: { amount: 120 },
    items: [{ id: 'live', quantity: 5 }],
    purchaseRequest: {
      snapshot: {
        purchaseRequestNumber: 'PR-2026-0001',
        requestStatus: 'APPROVED',
        totalAmount: 1500,
        amountDue: 1500,
        emptiesAdjustment: null,
        items: [{ id: 'requested', quantity: 3 }],
      },
    },
  }
  const record = toPurchaseRequestRecord(transaction)
  assert.equal(record.purchaseRequestNumber, 'PR-2026-0001')
  assert.equal(record.amountDue, 1500)
  assert.deepEqual(record.items, [{ id: 'requested', quantity: 3 }])
  // Actions still target the shared transaction.
  assert.equal(record.id, 'tx-1')
})

test('only real purchase-request documents are PRs', () => {
  assert.equal(isPurchaseRequestDocument({ purchaseRequest: { snapshot: {} }, orderNumber: 'PR-1' }), true)
  assert.equal(isPurchaseRequestDocument({ purchaseRequest: null, orderNumber: 'PR-1' }), false)
  assert.equal(isPurchaseRequestDocument({ purchaseRequest: {}, orderNumber: 'RPL-2026-0001' }), false)
  assert.equal(isPurchaseRequestDocument({ purchaseRequest: {}, isScheduledReplacement: true }), false)
  assert.equal(isPurchaseRequestDocument({ purchaseRequest: {}, salesChannel: 'RETAIL_POS' }), false)
})

test('PR status comes from the request decision, with legacy fallbacks', () => {
  assert.equal(getPurchaseRequestStatus({ requestStatus: 'PENDING_APPROVAL' }), 'PENDING_APPROVAL')
  assert.equal(getPurchaseRequestStatus({ requestStatus: 'PENDING' }), 'PENDING_APPROVAL')
  assert.equal(getPurchaseRequestStatus({ requestStatus: 'approved', status: 'CANCELLED' }), 'APPROVED')
  assert.equal(getPurchaseRequestStatus({ requestStatus: 'CANCELED' }), 'CANCELLED')
  assert.equal(getPurchaseRequestStatus({ status: 'REJECTED' }), 'REJECTED')
  assert.equal(getPurchaseRequestStatus({ status: 'PENDING' }), 'PENDING_APPROVAL')
  assert.equal(getPurchaseRequestStatus({ status: 'VOIDED' }), 'CANCELLED')
  assert.equal(getPurchaseRequestStatus({ status: 'DELIVERED' }), 'APPROVED')
})

test('PO stage follows the live order status so every screen shows the same stage', () => {
  // The admin tab used to read an approved PO as "Processing" and the warehouse
  // detail dialog as "Pending"; the report said "Approved PO".
  assert.equal(getPurchaseOrderStage({ status: 'APPROVED', purchaseOrderStage: 'APPROVED' }), 'APPROVED')
  assert.equal(getPurchaseOrderStage({ status: 'PREPARING', purchaseOrderStage: 'PROCESSING' }), 'PROCESSING')
  assert.equal(getPurchaseOrderStage({ status: 'RESCHEDULED', purchaseOrderStage: 'APPROVED' }), 'RESCHEDULED')
  assert.equal(getPurchaseOrderStage({ status: 'OUT_FOR_DELIVERY' }), 'OUT_FOR_DELIVERY')
  assert.equal(getPurchaseOrderStage({ status: 'IN_TRANSIT' }), 'OUT_FOR_DELIVERY')
  assert.equal(getPurchaseOrderStage({ status: 'DELIVERED', purchaseOrderStage: 'DELIVERED' }), 'DELIVERED')
  assert.equal(getPurchaseOrderStage({ status: 'REJECTED', purchaseOrderStage: 'CANCELLED' }), 'CANCELLED')
  assert.equal(getPurchaseOrderStage({ status: 'CANCELED' }), 'CANCELLED')
  // Legacy rows without a recognised status fall back to the stored stage.
  assert.equal(getPurchaseOrderStage({ purchaseOrderStage: 'READY_FOR_DELIVERY' }), 'PROCESSING')
  assert.equal(getPurchaseOrderStage({ purchaseOrderStage: 'COMPLETED' }), 'DELIVERED')
  assert.equal(getPurchaseOrderStage({}), 'APPROVED')
})

test('document amount is the order total, not a later empties charge', () => {
  assert.equal(getPurchaseDocumentAmount({ totalAmount: 1500, amountDue: 1620, subtotal: 1600 }), 1500)
  // A deposit credit can bring a request to zero; that is its real amount.
  assert.equal(getPurchaseDocumentAmount({ totalAmount: 0, subtotal: 800 }), 0)
  assert.equal(getPurchaseDocumentAmount({ subtotal: 800 }), 800)
})

test('a PO is dated by its approval, falling back to the request date', () => {
  assert.equal(getPurchaseOrderDate({ createdAt: '2026-09-20T02:00:00Z', approvedAt: '2026-09-26T03:00:00Z' }), '2026-09-26T03:00:00Z')
  assert.equal(getPurchaseOrderDate({ createdAt: '2026-09-20T02:00:00Z' }), '2026-09-20T02:00:00Z')
})

test('staff PO schedules use the delivery date and never fabricate one from creation', () => {
  assert.equal(getPurchaseOrderDeliveryDate({ deliveryDate: '2026-09-26', approvedAt: '2026-09-25T10:00:00Z' }), '2026-09-26')
  assert.equal(getPurchaseOrderDeliveryDate({ timeline: { deliveryDate: '2026-09-26' } }), '2026-09-26')
  assert.equal(getPurchaseOrderDeliveryDate({ createdAt: '2026-09-26T10:00:00Z' }), '')
  const now = new Date(2026, 8, 26, 15)
  assert.equal(matchesPurchaseDatePreset('2026-09-26', 'custom', '2026-09-26', now), true)
  assert.equal(matchesPurchaseDatePreset('2026-09-26', 'today', '', now), true)
  assert.equal(matchesPurchaseDatePreset('2026-09-27', 'today', '', now), false)
})

test('date presets use the report windows and local calendar days', () => {
  // Local-time constructors keep this independent of the test machine's zone.
  const now = new Date(2026, 8, 26, 15, 0, 0)
  const earlyToday = new Date(2026, 8, 26, 0, 30, 0).toISOString()
  const lateYesterday = new Date(2026, 8, 25, 23, 30, 0).toISOString()
  const sixDaysAgo = new Date(2026, 8, 20, 9, 0, 0).toISOString()
  const sevenDaysAgo = new Date(2026, 8, 19, 9, 0, 0).toISOString()

  assert.equal(matchesPurchaseDatePreset(earlyToday, 'today', '', now), true)
  assert.equal(matchesPurchaseDatePreset(lateYesterday, 'today', '', now), false)
  // "Past 7 days" is seven calendar days ending today, as in the reports.
  assert.equal(matchesPurchaseDatePreset(sixDaysAgo, '7', '', now), true)
  assert.equal(matchesPurchaseDatePreset(sevenDaysAgo, '7', '', now), false)
  assert.equal(matchesPurchaseDatePreset(sevenDaysAgo, 'all', '', now), true)
  // A custom day compares the local date, not the UTC prefix of the ISO string.
  assert.equal(matchesPurchaseDatePreset(earlyToday, 'custom', '2026-09-26', now), true)
  assert.equal(matchesPurchaseDatePreset(lateYesterday, 'custom', '2026-09-26', now), false)
  assert.equal(matchesPurchaseDatePreset(lateYesterday, 'custom', '', now), true)
  assert.equal(matchesPurchaseDatePreset(null, 'today', '', now), false)
})

test('customer note excludes lines the system appends to order notes', () => {
  assert.equal(getCustomerOrderNote({ notes: 'Please deliver after 3pm' }), 'Please deliver after 3pm')
  assert.equal(
    getCustomerOrderNote({
      notes: 'Gate code 1234\nCall on arrival\nOrder Note: Out of stock\nEmpties shortfall on delivery: 2 Crate declared but not handed over. ₱ 240.00 deposit is due.',
    }),
    'Gate code 1234\nCall on arrival'
  )
  assert.equal(getCustomerOrderNote({ notes: 'Order Note: Customer request' }), '')
  assert.equal(getCustomerOrderNote({ notes: null }), '')
})
