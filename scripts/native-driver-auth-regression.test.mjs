// Exercise the production native wrappers without requiring a device or sending real credentials.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, ...globals,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test('a Capacitor web shim does not hide the native shell or count as a ready bridge', async () => {
  let poll;
  let cleared = false;
  const window = {
    Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
    setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { cleared = true; },
  };
  const platform = loadModule('src/lib/native/platform.ts', {
    '@/lib/portal-scope': { parseNativePortalFromUserAgent: () => 'driver' },
  }, { window, navigator: { userAgent: 'Android AABTradingApp AABPortal/driver' } });
  assert.equal(platform.isNativeApp(), true);
  let settled = false;
  const waiting = platform.waitForNativeBridge().then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  window.Capacitor.nativePromise = async () => {};
  poll();
  assert.equal(await waiting, true);
  assert.equal(cleared, true);
});

test('an ordinary browser never waits for the native bridge', async () => {
  const platform = loadModule('src/lib/native/platform.ts', {
    '@/lib/portal-scope': { parseNativePortalFromUserAgent: () => null },
  }, { window: { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }, navigator: { userAgent: 'Chrome' } });
  assert.equal(platform.isNativeApp(), false);
  assert.equal(await platform.waitForNativeBridge(), false);
});

function locationPermissions(afterRequest) {
  let requests = 0;
  const permissions = loadModule('src/lib/native/permissions.ts', {
    './platform': { isNativeApp: () => true, waitForNativeBridge: async () => true, isPluginAvailable: () => true },
    '@capacitor/geolocation': { Geolocation: {
      checkPermissions: async () => ({ location: 'denied', coarseLocation: 'granted' }),
      requestPermissions: async () => { requests++; return afterRequest; },
    } },
  }, { window: {} });
  return { permissions, requests: () => requests };
}

test('driver upgrades approximate permission before starting its fine-location service', async () => {
  const setup = locationPermissions({ location: 'granted', coarseLocation: 'granted' });
  assert.equal((await setup.permissions.ensureLocationPermission({ precise: true })).granted, true);
  assert.equal(setup.requests(), 1);
});

test('approximate-only driver permission is rejected with an actionable explanation', async () => {
  const setup = locationPermissions({ location: 'denied', coarseLocation: 'granted' });
  const result = await setup.permissions.ensureLocationPermission({ precise: true });
  assert.equal(result.granted, false);
  assert.match(result.message, /Precise location/);
});

test('customer address selection continues to accept approximate location', async () => {
  const setup = locationPermissions({ location: 'denied', coarseLocation: 'granted' });
  assert.equal((await setup.permissions.ensureLocationPermission()).granted, true);
  assert.equal(setup.requests(), 0);
});

test('Android guidance calls native speech and mute stops it', async () => {
  const calls = [];
  const speech = loadModule('src/lib/native/driver-speech.ts', {
    '@capacitor/core': { registerPlugin: () => ({ speak: async options => calls.push(options.text), stop: async () => calls.push('stop') }) },
    './platform': { getPlatform: () => 'android', waitForNativeBridge: async () => true, isPluginAvailable: () => true },
  }, { window: {} });
  await speech.speakDriverNavigation('Turn right');
  speech.stopDriverNavigationSpeech();
  assert.deepEqual(calls, ['Turn right', 'stop']);
});

test('muting discards an instruction still waiting for the native bridge', async () => {
  let ready;
  const calls = [];
  const speech = loadModule('src/lib/native/driver-speech.ts', {
    '@capacitor/core': { registerPlugin: () => ({ speak: async () => calls.push('speak'), stop: async () => {} }) },
    './platform': { getPlatform: () => 'android', waitForNativeBridge: () => new Promise(resolve => { ready = resolve; }), isPluginAvailable: () => true },
  }, { window: {} });
  const pending = speech.speakDriverNavigation('Turn left');
  speech.stopDriverNavigationSpeech();
  ready(true);
  await pending;
  assert.equal(calls.length, 0);
});

test('browser guidance preserves speech synthesis and the Philippine English voice', async () => {
  let utterance;
  let cancelled = 0;
  const voice = { lang: 'en-PH' };
  const speech = loadModule('src/lib/native/driver-speech.ts', {
    '@capacitor/core': { registerPlugin: () => ({}) },
    './platform': { getPlatform: () => 'web' },
  }, {
    window: { speechSynthesis: { getVoices: () => [voice], cancel: () => cancelled++, speak: value => { utterance = value; } } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  });
  await speech.speakDriverNavigation('Continue straight');
  assert.equal(utterance.text, 'Continue straight');
  assert.equal(utterance.voice, voice);
  assert.equal(cancelled, 1);
});

test('customer web Google button is restored after session checking and cached-script remounts', () => {
  const source = fs.readFileSync(new URL('../src/components/auth/CustomerLoginPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /onReady=\{renderGoogleButton\}/);
  assert.match(source, /\[authMode, googleSignInAvailable, renderGoogleButton, isOtpPageOpen, isCheckingSession\]/);
});
