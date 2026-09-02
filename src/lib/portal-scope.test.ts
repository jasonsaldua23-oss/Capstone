import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPortalManifest } from './portal-manifest.ts'
import {
  homePathForPortal,
  isPathAllowedForPortal,
  loginPathForPortal,
  portalFromAppPath,
} from './portal-scope.ts'

test('Driver and Customer use separate canonical app paths', () => {
  assert.equal(homePathForPortal('driver'), '/driver')
  assert.equal(homePathForPortal('customer'), '/customer')
  assert.equal(loginPathForPortal('driver'), '/driver/login')
  assert.equal(loginPathForPortal('customer'), '/customer/login')
  assert.equal(portalFromAppPath('/driver/login'), 'driver')
  assert.equal(portalFromAppPath('/customer/orders'), 'customer')
})

test('native portal path guards reject the other installable portal', () => {
  assert.equal(isPathAllowedForPortal('/driver', 'driver'), true)
  assert.equal(isPathAllowedForPortal('/driver/login', 'driver'), true)
  assert.equal(isPathAllowedForPortal('/customer', 'driver'), false)
  assert.equal(isPathAllowedForPortal('/customer/login', 'driver'), false)

  assert.equal(isPathAllowedForPortal('/customer', 'customer'), true)
  assert.equal(isPathAllowedForPortal('/driver', 'customer'), false)
})

test('PWA manifests have stable IDs and disjoint navigation scopes', () => {
  const driver = buildPortalManifest('driver')
  const customer = buildPortalManifest('customer')

  assert.equal(driver.id, '/?portal=driver')
  assert.equal(customer.id, '/?portal=customer')
  assert.equal(driver.start_url, '/driver')
  assert.equal(customer.start_url, '/customer')
  assert.equal(driver.scope, '/driver')
  assert.equal(customer.scope, '/customer')
  assert.notEqual(driver.scope, customer.scope)
})
