import assert from 'node:assert/strict';
import test from 'node:test';
import { getDriverVehicleLicenseIssue } from './driver-eligibility.ts';
import {
  getRequiredLicenseCodeForVehicle,
  isLicenseCodeAllowedForVehicle,
} from './driver-license-restrictions.ts';

const NEEDS_C = 'Driver is not qualified to drive this vehicle. License Code C is required.';
const NEEDS_A1 = 'Driver is not qualified to drive this vehicle. License Code A1 is required.';

test('a truck requires Code C and a tricycle requires Code A1', () => {
  assert.equal(getRequiredLicenseCodeForVehicle('TRUCK'), 'C');
  assert.equal(getRequiredLicenseCodeForVehicle('TRICYCLE'), 'A1');
});

test('Code A does not cover a tricycle or a truck', () => {
  assert.equal(isLicenseCodeAllowedForVehicle('A', 'TRICYCLE'), false);
  assert.equal(isLicenseCodeAllowedForVehicle('A', 'TRUCK'), false);
});

test('Code C covers a truck, as does the trailer code CE', () => {
  assert.equal(isLicenseCodeAllowedForVehicle('C', 'TRUCK'), true);
  assert.equal(isLicenseCodeAllowedForVehicle('CE', 'TRUCK'), true);
});

test('a truck code also covers the lighter tricycle', () => {
  assert.equal(isLicenseCodeAllowedForVehicle('A1', 'TRICYCLE'), true);
  assert.equal(isLicenseCodeAllowedForVehicle('C', 'TRICYCLE'), true);
  assert.equal(isLicenseCodeAllowedForVehicle('CE', 'TRICYCLE'), true);
});

test('a Code A driver is rejected for a truck with the required message', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A' }, { type: 'TRUCK' }), NEEDS_C);
});

test('a Code A driver is rejected for a tricycle, which names Code A1', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A' }, { type: 'TRICYCLE' }), NEEDS_A1);
});

test('the code is read from a nested user record and normalised', () => {
  assert.equal(getDriverVehicleLicenseIssue({ user: { license_type: ' c ' } }, { type: 'TRUCK' }), '');
  assert.equal(getDriverVehicleLicenseIssue({ user: { license_type: 'a' } }, { type: 'TRUCK' }), NEEDS_C);
});

test('a Code C driver passes for a truck and for the lighter tricycle', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'C' }, { type: 'TRUCK' }), '');
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'C' }, { type: 'TRICYCLE' }), '');
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A1' }, { type: 'TRICYCLE' }), '');
});

test('an A1 rider is still not qualified for the heavier truck', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A1' }, { type: 'TRUCK' }), NEEDS_C);
});

test('a missing vehicle is not judged here', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A' }, undefined), '');
});

test('legacy vehicle types stay unruled so existing assignments remain valid', () => {
  for (const legacyType of ['VAN', 'CAR', 'MOTORCYCLE', '']) {
    assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'A' }, { type: legacyType }), '', legacyType);
  }
});
