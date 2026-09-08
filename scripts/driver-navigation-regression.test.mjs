// Regression harness runs the production route effects with controlled GPS, timers, and network responses.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Normalize Windows line endings before locating the production effect boundaries.
const source = fs.readFileSync(new URL('../src/components/portals/driver/sections/trips/trip-detail-view.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function effectBetween(startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, startText);
  return ts.transpile(source.slice(start, source.indexOf(endText, start)), { target: ts.ScriptTarget.ES2020 });
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('the production animation keeps one frame loop, moves off-route, and reconciles hidden GPS', async () => {
  const navigation = await import('../src/lib/map-navigation.ts');
  const mapSource = fs.readFileSync(new URL('../src/components/shared/LiveTrackingMap.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('map.tsx', mapSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = new Set(['normalizeAngle', 'shortestAngleDelta', 'lerp', 'lerpAngle', 'toLocalXY', 'fromLocalXY', 'approximateDistanceMeters', 'nearestPointOnSegment', 'nearestPointOnPolyline']);
  let declarations = '';
  let effect;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && helpers.has(node.name?.text)) declarations += node.getText(tree) + '\n';
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(tree).startsWith('TRUCK_'))) declarations += node.getText(tree) + '\n';
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('const receivedAt = performance.now()')) effect = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect);
  const frames = new Map();
  let frameId = 0;
  let clock = 0;
  const truck = (lat, lng = 123) => ({ id: 'driver', markerType: 'truck', lat, lng, actualLat: lat, actualLng: lng, speedMps: 2, markerHeading: 0 });
  const context = {
    ...navigation, useEffect: fn => fn(), performance: { now: () => clock }, document: { hidden: false },
    window: { requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id) },
    animationFrameRef: { current: null }, lastTruckTargetAtRef: { current: null }, acceptedRouteProgressRef: { current: null },
    smoothedLocationsRef: { current: [truck(10)] }, snappedLocations: [truck(10.0002)],
    navigationPerspective: true, navigationRouteGeometry: [[10, 123], [10.01, 123]], navigationRouteKey: 'road',
    truckTargetSignature: 'fix', mapVisibilityEpoch: 0,
    setSmoothedLocations: value => assert.ok(Array.isArray(value), 'state updaters must never own animation scheduling'),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(declarations, { target: ts.ScriptTarget.ES2020 }), context);
  const run = () => vm.runInContext(ts.transpile(effect, { target: ts.ScriptTarget.ES2020 }), context);
  const frame = ms => { clock = ms; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(ms); };
  run();
  assert.equal(frames.size, 1);
  frame(450);
  const halfway = context.smoothedLocationsRef.current[0].lat;
  frame(900);
  assert.ok(context.smoothedLocationsRef.current[0].lat > halfway);
  assert.equal(frames.size, 1, 'interpolation owns exactly one future frame');
  context.snappedLocations = [truck(10.0003, 123.002)];
  run();
  frame(1300);
  assert.ok(context.smoothedLocationsRef.current[0].lng > 123, 'a detour moves the truck off the obsolete route');
  context.document.hidden = true;
  context.snappedLocations = [truck(10.002, 123.003)];
  run();
  assert.equal(frames.size, 0);
  assert.equal(context.smoothedLocationsRef.current[0].lat, 10.002, 'hidden fixes update actual progress without waiting for a paint');
  context.document.hidden = false;
  clock = 60000;
  context.snappedLocations = [truck(10.004, 123.003)];
  run();
  assert.equal(context.smoothedLocationsRef.current[0].lat, 10.004, 'resume adopts the current fix instead of replaying the stale journey');
});

test('the production waypoint builder always anchors at the assigned warehouse', () => {
  const tree = ts.createSourceFile('trip.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'navigationRouteWaypoints') initializer = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(initializer);
  const code = ts.transpile(`result = ${initializer}`, { target: ts.ScriptTarget.ES2020 });
  const context = { warehouseRouteStart: { lat: 10, lng: 123 }, completedDropPoints: [],
    stableNavigationOrigin: { lat: 10.005, lng: 123.002 }, pendingDropPoints: [{ latitude: 10.01, longitude: 123.003 }] };
  vm.runInNewContext(code, context);
  assert.equal(context.result[0], context.warehouseRouteStart);
  context.stableNavigationOrigin = { lat: 10.006, lng: 123.004 };
  vm.runInNewContext(code, context);
  assert.equal(context.result[0], context.warehouseRouteStart);
  assert.equal(context.result[1], context.stableNavigationOrigin);
  context.warehouseRouteStart = null;
  vm.runInNewContext(code, context);
  assert.equal(context.result.length, 0, 'missing warehouse coordinates must not silently turn GPS into the origin');
});

test('an unavailable GPS speed reaches the map as unknown, not a parked vehicle', () => {
  const start = source.indexOf('  const driverLocationMarker = (() => {');
  const code = ts.transpile(source.slice(start, source.indexOf('\n\n  // Do not calculate driver ETA', start)) + '\nresult = driverLocationMarker;', { target: ts.ScriptTarget.ES2020 });
  const context = {
    effectiveDriverLocation: { lat: 10.005, lng: 123.002, speed: null },
    toCoordinate: value => value == null ? null : Number(value), trip: { id: 'trip' },
    isTracking: true, driverLocationMarkerLabel: 'Driver', driverMarkerHeading: undefined, nextDropPoint: null,
  };
  vm.runInNewContext(code, context);
  assert.equal(context.result.speedMps, undefined);
  context.effectiveDriverLocation.speed = 0;
  vm.runInNewContext(`(() => { ${code} })()`, context);
  assert.equal(context.result.speedMps, 0, 'a real zero speed is still preserved');
});

test('a finished request is reconsidered on the clock at unchanged GPS, including repeated failures', async () => {
  const { shouldRefreshDriverRoute, selectFollowedRoute } = await import('../src/lib/map-navigation.ts');
  const code = effectBetween('  useEffect(() => {\n    if (!driverLocationMarker) return', '\n\n  const fullRouteWaypoints');
  let origin = { tripId: 'trip', lat: 10, lng: 123, revision: 1 };
  const context = {
    useEffect: fn => fn(), trip: { id: 'trip' }, driverLocationMarker: { lat: 10.005, lng: 123.002 },
    effectiveDriverLocation: { speed: null }, navigationStopsKey: 'stop', navigationStopsKeyRef: { current: 'stop' },
    navigationRouteOrigin: origin, navigationRouteCheckEpoch: 1,
    navigationRouteRequestInFlightRef: { current: true }, navigationRouteLastRequestAtRef: { current: 0 },
    routeOptions: [{ points: [[10, 123], [10.01, 123]] }], activeRouteOptionIndex: 0,
    Date: { now: () => 13000 }, shouldRefreshDriverRoute, selectFollowedRoute,
    navigationRouteRetryAtRef: { current: 0 },
    navigationRouteAbortRef: { current: null }, navigationRouteSelectionEpochRef: { current: 0 },
    setNavigationRouteOrigin: fn => { origin = fn(origin); },
  };
  vm.runInNewContext(code, context);
  assert.equal(origin.revision, 1, 'GPS does not cancel the active request');
  context.navigationRouteRequestInFlightRef.current = false;
  for (let revision = 2; revision <= 7; revision++) {
    vm.runInNewContext(code, context);
    assert.equal(origin.revision, revision, 'clock schedules a new request without leaving the screen');
    context.navigationRouteOrigin = origin;
  }
});

test('warehouse is the first requested waypoint and its legs cannot override live navigation', async () => {
  const code = effectBetween('  useEffect(() => {\n    const uniqueWaypoints = navigationRouteWaypoints', '\n\n  useEffect(() => {\n    const activeOption');
  const timers = new Map();
  const requests = [];
  let options;
  let cleanup;
  const warehouse = { lat: 10, lng: 123 };
  const gps = { lat: 10.005, lng: 123.002 };
  const stop = { lat: 10.01, lng: 123.003 };
  const context = {
    useEffect: fn => { cleanup = fn(); }, AbortController, Date,
    window: { setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) },
    navigationRouteWaypoints: [warehouse, gps, stop], navigationWaypointsKey: 'trip:2',
    stableNavigationOrigin: gps, driverMarkerHeading: undefined, effectiveDriverLocation: { speed: null },
    navigationRouteRequestInFlightRef: { current: false }, navigationRouteLastRequestAtRef: { current: 0 },
    navigationRouteRetryAtRef: { current: 0 }, isTracking: true,
    navigationRouteAbortRef: { current: null }, navigationRouteSelectionEpochRef: { current: 0 },
    routeOptions: [{ points: [[10, 123], [10.01, 123]] }],
    setRouteOptions: value => { options = value; }, setActiveRouteOptionIndex: () => {},
    setRouteSteps: () => {}, setCurrentStepIndex: () => {},
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })),
  };
  vm.runInNewContext(code, context);
  assert.match(requests[0].url, /driving\/123,10;123.002,10.005;123.003,10.01\?/);
  assert.equal(context.navigationRouteRequestInFlightRef.current, true);
  assert.equal(options, undefined, 'retain the old route while the new request is pending');
  const leg = (from, to, name) => ({ steps: [{ name, maneuver: { type: 'depart', location: [from.lng, from.lat] },
    geometry: { coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }, distance: 100, duration: 10 }] });
  requests[0].resolve({ ok: true, json: async () => ({ routes: [{ legs: [leg(warehouse, gps, 'warehouse'), leg(gps, stop, 'next road')] }] }) });
  await flush();
  assert.equal(context.navigationRouteRequestInFlightRef.current, false);
  assert.equal(options[0].originPoints[0][0], warehouse.lat);
  assert.equal(options[0].points[0][0], gps.lat);
  assert.equal(options[0].steps[0].name, 'next road');
  assert.equal(requests.length, 1, 'reroutes are not delayed by synthetic alternatives');
  cleanup();
  assert.equal(requests[0].init.signal.aborted, true);

  // A timed-out request must release the in-flight gate and retry with a fresh abort signal.
  context.fetch = (url, init) => new Promise((resolve, reject) => {
    requests.push({ url, init, resolve });
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  vm.runInNewContext(code, context);
  [...timers.values()].find(timer => timer.ms === 12000).fn();
  await flush();
  assert.equal(context.navigationRouteRequestInFlightRef.current, false);
  [...timers.values()].find(timer => timer.ms === 2500).fn();
  assert.equal(requests.at(-1).init.signal.aborted, false);
  assert.equal(context.navigationRouteRequestInFlightRef.current, true);
  cleanup();
  await flush();
  assert.equal(context.navigationRouteRequestInFlightRef.current, false);
});

test('following an alternative promotes it locally while a routing request is pending', async () => {
  const { selectFollowedRoute } = await import('../src/lib/map-navigation.ts');
  const code = effectBetween('  useEffect(() => {\n    if (!driverLocationMarker) return', '\n\n  const fullRouteWaypoints');
  const controller = new AbortController();
  let selected = 0;
  const context = {
    useEffect: fn => fn(), trip: { id: 'trip' },
    driverLocationMarker: { lat: 10.005, lng: 123.002, markerHeading: 0 },
    routeOptions: [{ points: [[10, 123], [10.01, 123]] }, { points: [[10, 123.002], [10.01, 123.002]] }],
    activeRouteOptionIndex: 0, selectFollowedRoute,
    navigationRouteSelectionEpochRef: { current: 0 }, navigationRouteAbortRef: { current: controller },
    navigationRouteRequestInFlightRef: { current: true },
    setActiveRouteOptionIndex: value => { selected = value; },
    navigationStopsKey: '', navigationRouteCheckEpoch: 0,
  };
  vm.runInNewContext(code, context);
  assert.equal(selected, 1);
  assert.equal(controller.signal.aborted, true);
  assert.equal(context.navigationRouteSelectionEpochRef.current, 1);
  assert.equal(context.navigationRouteRequestInFlightRef.current, false);
});

test('an obsolete slow route response cannot replace a locally selected alternative', async () => {
  const code = effectBetween('  useEffect(() => {\n    const uniqueWaypoints = navigationRouteWaypoints', '\n\n  useEffect(() => {\n    const activeOption');
  let resolveResponse;
  let cleanup;
  const context = {
    useEffect: fn => { cleanup = fn(); }, AbortController, Date,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    navigationRouteWaypoints: [{ lat: 10, lng: 123 }, { lat: 10.01, lng: 123 }], navigationWaypointsKey: 'trip',
    stableNavigationOrigin: null, driverMarkerHeading: undefined, effectiveDriverLocation: null, isTracking: true,
    navigationRouteRequestInFlightRef: { current: false }, navigationRouteLastRequestAtRef: { current: 0 },
    navigationRouteRetryAtRef: { current: 0 }, navigationRouteAbortRef: { current: null },
    navigationRouteSelectionEpochRef: { current: 0 },
    fetch: () => new Promise(resolve => { resolveResponse = resolve; }),
    setRouteOptions: () => assert.fail('stale response replaced the selected route'),
  };
  vm.runInNewContext(code, context);
  context.navigationRouteSelectionEpochRef.current++;
  resolveResponse({ ok: true, json: async () => ({ routes: [] }) });
  await flush();
  cleanup();
});
