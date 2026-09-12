import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, globals) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { exports, ...globals })
  return exports
}

test('phone Back dismisses dialogs first, then nested screens, then the portal; handlers clean up', () => {
  let modal = false, escape = false, nested = true, parent = 0
  const cleanup = []
  const back = load('src/hooks/use-native-back.ts', {
    require: () => ({ useRef: value => ({ current: value }), useEffect: effect => cleanup.push(effect()) }),
    KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options) } },
    document: { querySelector: () => modal, dispatchEvent: event => { escape = event.key === 'Escape' } },
  })
  back.useNativeBack(() => { parent++; return true })
  back.useNativeBack(() => { if (!nested) return false; nested = false; return true }, 10)
  modal = true
  assert.equal(back.handleNativeBack(), true)
  assert.equal(escape, true)
  assert.equal(nested, true)
  modal = false
  back.handleNativeBack()
  assert.equal(parent, 0)
  back.handleNativeBack()
  assert.equal(parent, 1)
  cleanup.forEach(stop => stop())
  assert.equal(back.hasNativeBackHandlers(), false)
  assert.equal(back.handleNativeBack(), false)
})

test('native speech registers only after the bridge is ready and distinguishes delayed from missing plugins', async () => {
  for (const ready of [true, false]) {
    let registered = false, spoken = ''
    const speech = load('src/lib/native/driver-speech.ts', {
      window: {},
      require: name => name === '@capacitor/core' ? {
        registerPlugin: () => { registered = true; return { speak: async ({ text }) => { spoken = text } } },
      } : {
        getPlatform: () => 'android', isPluginAvailable: () => true,
        waitForNativeBridge: async () => ready,
      },
    })
    assert.equal(registered, false)
    if (ready) {
      await speech.speakDriverNavigation('Turn right')
      assert.equal(spoken, 'Turn right')
    } else {
      await assert.rejects(speech.speakDriverNavigation('Turn right'), /still connecting/)
      assert.equal(registered, false)
    }
  }
})

test('muting while the native bridge starts prevents a stale voice instruction', async () => {
  let resolveBridge, spoken = false
  const speech = load('src/lib/native/driver-speech.ts', {
    window: {},
    require: name => name === '@capacitor/core' ? {
      registerPlugin: () => ({ speak: async () => { spoken = true }, stop: async () => {} }),
    } : {
      getPlatform: () => 'android', isPluginAvailable: () => true,
      waitForNativeBridge: () => new Promise(resolve => { resolveBridge = resolve }),
    },
  })
  const pending = speech.speakDriverNavigation('Turn left')
  speech.stopDriverNavigationSpeech()
  resolveBridge(true)
  await pending
  assert.equal(spoken, false)
})
