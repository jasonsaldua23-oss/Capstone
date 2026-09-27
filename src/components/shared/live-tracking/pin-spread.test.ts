import test from 'node:test'
import assert from 'node:assert/strict'
import { coincidentPinTilts, rotateScreenOffset } from './pin-spread.ts'
import type { DriverLocation } from './types'

const pin = (id: string, lat: number, lng: number, markerType: DriverLocation['markerType'] = 'pin'): DriverLocation =>
  ({ id, lat, lng, markerType, driverName: id, vehiclePlate: '', status: 'PENDING' }) as DriverLocation

test('a pin alone at its coordinate stays upright', () => {
  const tilts = coincidentPinTilts([pin('a', 10.7, 122.97), pin('b', 10.71, 122.97)], 45)
  assert.equal(tilts.size, 0)
})

test('pins sharing a coordinate fan out evenly about upright', () => {
  const tilts = coincidentPinTilts([pin('a', 10.7, 122.97), pin('b', 10.7, 122.97), pin('c', 10.7, 122.97)], 45)
  assert.deepEqual([tilts.get('a'), tilts.get('b'), tilts.get('c')], [-45, 0, 45])
})

test('two pins at one coordinate lean either side of upright', () => {
  const tilts = coincidentPinTilts([pin('a', 10.7, 122.97), pin('b', 10.7, 122.97)], 45)
  assert.deepEqual([tilts.get('a'), tilts.get('b')], [-22.5, 22.5])
})

test('a large group narrows its step instead of laying pins down', () => {
  const group = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => pin(id, 10.7, 122.97))
  const tilts = [...coincidentPinTilts(group, 45).values()]
  assert.equal(Math.min(...tilts), -75)
  assert.equal(Math.max(...tilts), 75)
})

test('float noise below a metre still counts as the same coordinate', () => {
  const tilts = coincidentPinTilts([pin('a', 10.7000001, 122.9700002), pin('b', 10.7, 122.97)], 45)
  assert.equal(tilts.size, 2)
})

test('trucks and dots at the same point are ignored', () => {
  const tilts = coincidentPinTilts([
    pin('a', 10.7, 122.97),
    pin('truck', 10.7, 122.97, 'truck'),
    pin('dot', 10.7, 122.97, 'dot'),
  ], 45)
  assert.equal(tilts.size, 0)
})

test('turning an upward offset clockwise leans it to the right', () => {
  const [x, y] = rotateScreenOffset([0, -34], 90)
  assert.ok(Math.abs(x - 34) < 1e-9 && Math.abs(y) < 1e-9)
})
