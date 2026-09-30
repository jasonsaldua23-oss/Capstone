import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DepositRefundRow, EmptiesExchangeRow, getDepositRefundAmount } from './empties-charge-note'

const render = (row: typeof EmptiesExchangeRow, order: object) => renderToStaticMarkup(React.createElement(row, { order }))

// 24 cases of 7Up 8oz, 20 of them exchanged for the customer's declared existing empties.
const exchangeOrder = {
  items: [{
    productName: '7Up',
    product: { name: '7Up', sizes: ['8oz'], unit: 'case' },
    productUnit: 'case',
    containersPerCase: 24,
    quantity: 24,
    emptyReturnedQuantity: 480,
    depositRefunded: 1800,
    netDeposit: 360,
  }],
  depositRefundClaims: [],
}

test('empties exchanged at checkout are shown as covering the deposit, never as a refund', () => {
  const html = render(EmptiesExchangeRow, exchangeOrder)
  assert.match(html, /Empties used at checkout/)
  assert.match(html, /7Up 8oz: 20 cases/)
  // The net deposit already leaves these out, so nothing is subtracted a second time.
  assert.match(html, /Covers ₱1,800\.00/)
  assert.doesNotMatch(html, /-₱/)
  assert.equal(render(DepositRefundRow, exchangeOrder), '')
  assert.equal(getDepositRefundAmount(exchangeOrder), 0)
  assert.doesNotMatch(html, /refund/i)
})

test('mixed-case components list the bottles exchanged', () => {
  const html = render(EmptiesExchangeRow, {
    items: [{ itemType: 'MIXED_CASE', components: [{ productName: 'Coke', emptyCoveredQuantity: 12, depositPerUnit: 3.75 }] }],
  })
  assert.match(html, /Coke: 12 bottles/)
  assert.match(html, /Covers ₱45\.00/)
})

test('a refund claim is still a refund that lowers the order total', () => {
  const refundOrder = {
    items: [{ productName: 'Pepsi', quantity: 2 }],
    depositRefundClaims: [{ id: 'claim', productName: 'Pepsi', requestedCases: 1, requestedLooseBottles: 0, requestedAmount: 90 }],
  }
  const html = render(DepositRefundRow, refundOrder)
  assert.match(html, /Empty deposit refund/)
  assert.match(html, /Pepsi: 1 case/)
  assert.match(html, /-₱90\.00/)
  assert.equal(getDepositRefundAmount(refundOrder), 90)
  assert.equal(render(EmptiesExchangeRow, refundOrder), '')
})
