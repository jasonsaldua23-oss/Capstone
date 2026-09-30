import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the hook's async save/load contract without a live account or notification delivery.
function mountPreferences({ portal = 'customer', saved = {}, failSave = false, failLoad = false, delaySave } = {}) {
  const slots = []
  const effects = []
  const calls = []
  const errors = []
  let cursor = 0
  let output
  let currentAccount = 'account-a'
  let stored = { ...(portal === 'customer' ? { orderUpdates: true } : { tripNotifications: true }), deliveryUpdates: true, ...saved }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(callback, dependencies) {
      const index = cursor++
      if (!slots[index] || dependencies.some((value, i) => value !== slots[index].dependencies[i])) slots[index] = { callback, dependencies }
      return slots[index].callback
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      if (!slots[index] || dependencies.some((value, i) => value !== slots[index].dependencies[i])) {
        slots[index]?.cleanup?.()
        slots[index] = { dependencies }
        effects.push(() => { slots[index].cleanup = effect() })
      }
    },
  }
  const exports = {}
  const source = fs.readFileSync(new URL('../src/hooks/use-notification-preferences.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    Error, // Keep thrown fetch errors in the same realm as the hook's instanceof check.
    require: (name) => {
      if (name === 'react') return react
      if (name === 'sonner') return { toast: { error: (error) => errors.push(error) } }
      throw new Error(`Unexpected dependency ${name}`)
    },
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      if (options.method === 'PATCH') {
        await delaySave?.()
        if (failSave) return { ok: false, json: async () => ({ error: 'Save rejected' }) }
        stored = { ...stored, ...JSON.parse(options.body) }
      } else if (failLoad) throw new Error('Load failed')
      return { ok: true, json: async () => ({ success: true, preferences: { ...stored } }) }
    },
  })
  const render = () => { cursor = 0; output = exports.useNotificationPreferences(currentAccount, portal); while (effects.length) effects.shift()(); return output }
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); return render() }
  return { render, settle, calls, errors, get current() { return output }, switchAccount(id) { currentAccount = id; render() } }
}

for (const portal of ['customer', 'driver']) {
  test(`${portal} loads saved choices and confirms each switch off/on through the API`, async () => {
    const key = portal === 'customer' ? 'orderUpdates' : 'tripNotifications'
    const hook = mountPreferences({ portal, saved: { [key]: false } })
    assert.equal(hook.render().disabled, true)
    await hook.settle()
    assert.equal(hook.current.preferences[key], false)
    for (const field of [key, 'deliveryUpdates']) {
      for (const value of [true, false, true]) {
        await hook.current.save({ ...hook.current.preferences, [field]: value })
        await hook.settle()
        assert.equal(hook.current.preferences[field], value)
      }
    }
    assert.ok(hook.calls.every((call) => call.headers['X-Portal'] === portal))
    assert.ok(hook.calls.filter((call) => call.body).every((call) => Object.keys(JSON.parse(call.body)).length === 1))
    await hook.current.reload()
    await hook.settle()
    assert.equal(hook.current.preferences[key], true)
  })
}

test('failed save leaves the confirmed choice unchanged and reports the error', async () => {
  const hook = mountPreferences({ failSave: true })
  hook.render()
  await hook.settle()
  await hook.current.save({ orderUpdates: false })
  await hook.settle()
  assert.equal(hook.current.preferences.orderUpdates, true)
  assert.equal(hook.current.disabled, false)
  assert.deepEqual(hook.errors, ['Save rejected'])
})

test('load failure prevents editing unknown preferences', async () => {
  const hook = mountPreferences({ failLoad: true })
  hook.render()
  await hook.settle()
  assert.equal(hook.current.disabled, true)
  assert.equal(hook.current.error, 'Load failed')
  await hook.current.save({ orderUpdates: false })
  assert.equal(hook.calls.length, 1)
})

test('rapid taps cannot overlap notification saves', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const hook = mountPreferences({ delaySave: () => pending })
  hook.render()
  await hook.settle()
  const first = hook.current.save({ orderUpdates: false })
  await hook.current.save({ deliveryUpdates: false })
  assert.equal(hook.calls.filter((call) => call.method === 'PATCH').length, 1)
  assert.equal(hook.render().disabled, true)
  release()
  await first
  await hook.settle()
  assert.equal(hook.current.preferences.orderUpdates, false)
  assert.equal(hook.current.preferences.deliveryUpdates, true)
})
