import test from 'node:test'
import assert from 'node:assert/strict'
import { trackingCredentialsChanged } from './driver-tracking-policy.ts'

const session = { driverId: 'drv-1', token: 'tok-a', tripId: 'trip-9' }

test('the first hand-off always reaches the service', () => {
  assert.equal(trackingCredentialsChanged(null, session), true)
})

test('an unchanged session is not re-sent, so the service keeps its upload backoff', () => {
  assert.equal(trackingCredentialsChanged(session, { ...session }), false)
})

test('a refreshed token, a different driver or a different trip each warrant a restart', () => {
  assert.equal(trackingCredentialsChanged(session, { ...session, token: 'tok-b' }), true)
  assert.equal(trackingCredentialsChanged(session, { ...session, driverId: 'drv-2' }), true)
  assert.equal(trackingCredentialsChanged(session, { ...session, tripId: '' }), true)
})
