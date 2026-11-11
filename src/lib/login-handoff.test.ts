import assert from 'node:assert/strict'
import test from 'node:test'

import { LOGIN_HANDOFF_MAX_AGE_MS, takeLoginHandoff, writeLoginHandoff } from './login-handoff.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
    size: () => values.size,
  }
}

const TOKEN = 'header.payload.signature-of-this-exact-session-token'
const USER = { id: 'u1', email: 'admin@example.com', role: 'ADMIN', name: 'Admin' }

test('the portal receives the user the sign-in response just confirmed', () => {
  const storage = memoryStorage()
  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: true, now: 1_000 })

  const user = takeLoginHandoff(storage, { token: TOKEN, now: 1_500 })

  // Matches what /api/auth/me returns: the account payload plus the signed remember-me choice.
  assert.deepEqual(user, { ...USER, rememberMe: true })
})

test('a hand-off is used once, so a reload still asks the server', () => {
  const storage = memoryStorage()
  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: false, now: 1_000 })

  assert.ok(takeLoginHandoff(storage, { token: TOKEN, now: 1_100 }))
  assert.equal(takeLoginHandoff(storage, { token: TOKEN, now: 1_200 }), null)
  assert.equal(storage.size(), 0)
})

test('a hand-off for a different session token is ignored', () => {
  const storage = memoryStorage()
  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: false, now: 1_000 })

  assert.equal(takeLoginHandoff(storage, { token: 'header.payload.another-session', now: 1_100 }), null)
  assert.equal(takeLoginHandoff(storage, { token: null, now: 1_100 }), null)
})

test('a stale or future-dated hand-off is ignored', () => {
  const storage = memoryStorage()
  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: false, now: 1_000 })
  assert.equal(takeLoginHandoff(storage, { token: TOKEN, now: 1_000 + LOGIN_HANDOFF_MAX_AGE_MS + 1 }), null)

  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: false, now: 5_000 })
  assert.equal(takeLoginHandoff(storage, { token: TOKEN, now: 1_000 }), null)
})

test('a malformed hand-off is ignored and removed', () => {
  const storage = memoryStorage()
  for (const raw of ['not json', '{}', JSON.stringify({ user: { email: 'x' }, tokenTail: TOKEN.slice(-24), at: 1 })]) {
    storage.setItem('login-handoff', raw)
    assert.equal(takeLoginHandoff(storage, { token: TOKEN, now: 2 }), null)
    assert.equal(storage.size(), 0)
  }
})

test('the session token itself is not copied into the hand-off', () => {
  const storage = memoryStorage()
  writeLoginHandoff(storage, { user: USER, token: TOKEN, rememberMe: false, now: 1_000 })

  assert.equal(String(storage.getItem('login-handoff')).includes(TOKEN), false)
})

test('unavailable storage never breaks sign-in', () => {
  const broken = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  assert.doesNotThrow(() => writeLoginHandoff(broken, { user: USER, token: TOKEN, rememberMe: false, now: 1 }))
  assert.equal(takeLoginHandoff(broken, { token: TOKEN, now: 2 }), null)
})
