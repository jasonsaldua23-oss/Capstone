import test from 'node:test'
import assert from 'node:assert/strict'
import { isAtWarehouse, toMapWarehouses, warehouseFocusPoint } from './warehouse-markers.ts'

const gamboa = {
  id: 'wh-1',
  name: 'Gamboa-warehouse',
  address: 'Gamboa Street',
  city: 'Talisay',
  province: 'Negros Occidental',
  latitude: 10.743872,
  longitude: 122.966716,
  isActive: true,
}

test('toMapWarehouses keeps warehouses that have a location', () => {
  assert.deepEqual(toMapWarehouses([gamboa]), [
    {
      id: 'wh-1',
      name: 'Gamboa-warehouse',
      address: 'Gamboa Street, Talisay, Negros Occidental',
      lat: 10.743872,
      lng: 122.966716,
    },
  ])
  // Coordinates can arrive as strings from older payloads.
  assert.equal(toMapWarehouses([{ ...gamboa, latitude: '10.7', longitude: '122.9' }])[0]?.lat, 10.7)
})

test('toMapWarehouses skips warehouses it cannot place or that no longer operate', () => {
  assert.deepEqual(
    toMapWarehouses([
      { ...gamboa, id: 'no-lat', latitude: null },
      { ...gamboa, id: 'blank-lng', longitude: '' },
      { ...gamboa, id: 'bad', latitude: 'unknown' },
      { ...gamboa, id: 'closed', isActive: false },
      { ...gamboa, id: '' },
      null,
    ]),
    []
  )
  assert.equal(toMapWarehouses(undefined).length, 0)
})

test('toMapWarehouses lists each warehouse once and names unnamed ones', () => {
  const warehouses = toMapWarehouses([gamboa, gamboa, { ...gamboa, id: 'wh-2', name: '  ', address: '', city: 'Silay', province: '' }])
  assert.deepEqual(warehouses.map((warehouse) => warehouse.id), ['wh-1', 'wh-2'])
  assert.equal(warehouses[1]?.name, 'Warehouse')
  assert.equal(warehouses[1]?.address, 'Silay')
})

test('isAtWarehouse matches a point standing on the warehouse, not one down the road', () => {
  const warehouses = toMapWarehouses([gamboa])
  assert.equal(isAtWarehouse([10.743872, 122.966716], warehouses), true)
  // About 30 m north: still the same yard.
  assert.equal(isAtWarehouse([10.74414, 122.966716], warehouses), true)
  // About 200 m east: a different place.
  assert.equal(isAtWarehouse([10.743872, 122.9685], warehouses), false)
  assert.equal(isAtWarehouse([10.743872, 122.966716], []), false)
  assert.equal(isAtWarehouse(null, warehouses), false)
})

test('warehouseFocusPoint opens on the warehouse only when nothing else is on the map', () => {
  const warehouses = toMapWarehouses([gamboa])
  assert.deepEqual(warehouseFocusPoint(0, warehouses), [10.743872, 122.966716])
  assert.equal(warehouseFocusPoint(3, warehouses), null)
  assert.equal(warehouseFocusPoint(0, []), null)
})
