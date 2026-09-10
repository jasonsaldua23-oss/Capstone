import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the actual native helper without opening accounts or sending ID tokens.
function loadLogin(login, bridgeReady = async () => true) {
  const source = readFileSync(new URL('../src/lib/native/google-auth.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, window: {}, process: { env: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client' } },
    require: (name) => {
      if (name === './platform') return {
        isNativeApp: () => true, isPluginAvailable: () => true, waitForNativeBridge: bridgeReady,
      }
      assert.equal(name, '@capgo/capacitor-social-login')
      return { SocialLogin: { initialize: async () => {}, login } }
    },
  })
  return exports.signInWithGoogleNatively
}

test('native cancellation and credential errors remain visible after the picker closes', async () => {
  for (const message of ['Google Sign-In failed: activity cancelled', 'Developer console is not set up correctly', 'User cancelled']) {
    const signIn = loadLogin(async () => { throw new Error(message) })
    const result = await signIn()
    assert.equal(result.ok, false)
    assert.equal(result.message, message)
  }
})

test('missing token and empty native errors always provide feedback', async () => {
  for (const login of [async () => ({ result: {} }), async () => { throw new Error('') }]) {
    const result = await loadLogin(login)()
    assert.equal(result.ok, false)
    assert.ok(result.message.length > 0)
  }
})

test('successful login passes the real native token to the caller', async () => {
  const result = await loadLogin(async () => ({ result: { idToken: 'test-id-token' } }))()
  assert.equal(result.ok, true)
  assert.equal(result.idToken, 'test-id-token')
})

test('bridge failures report an error without invoking the account picker', async () => {
  let calls = 0
  const login = async () => { calls++; return { result: { idToken: 'test' } } }
  for (const ready of [async () => false, async () => { throw new Error('Bridge not ready') }]) {
    const result = await loadLogin(login, ready)()
    assert.equal(result.ok, false)
    assert.ok(result.message)
  }
  assert.equal(calls, 0)
})
