import assert from 'node:assert/strict';
import test from 'node:test';
import { getDriverVehicleLicenseIssue, getDriverProfileCompletenessIssue } from './driver-eligibility.ts';
import {
  getRequiredLicenseCodeForVehicle,
  isValidDriverLicenseRestriction,
  parseDriverLicenseCodes,
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

test('Code C covers a truck; CE alone does not', () => {
  assert.equal(isLicenseCodeAllowedForVehicle('C', 'TRUCK'), true);
  assert.equal(isLicenseCodeAllowedForVehicle('CE', 'TRUCK'), false);
});

test('a tricycle requires its own explicit A1 code', () => {
  assert.equal(isLicenseCodeAllowedForVehicle('A1', 'TRICYCLE'), true);
  assert.equal(isLicenseCodeAllowedForVehicle('C', 'TRICYCLE'), false);
  assert.equal(isLicenseCodeAllowedForVehicle('CE', 'TRICYCLE'), false);
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

test('a Code C driver passes for a truck but still needs A1 for a tricycle', () => {
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'C' }, { type: 'TRUCK' }), '');
  assert.equal(getDriverVehicleLicenseIssue({ licenseType: 'C' }, { type: 'TRICYCLE' }), NEEDS_A1);
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

test('multiple explicit codes qualify independently and reject invalid combinations', () => {
  assert.deepEqual(parseDriverLicenseCodes(' a1, c, A1 '), ['A1', 'C']);
  for (const codes of ['A1,C', ' c a1 ', 'A1,C,CE']) {
    assert.equal(isValidDriverLicenseRestriction(codes), true);
    assert.equal(getDriverVehicleLicenseIssue({ licenseType: codes }, { type: 'TRUCK' }), '');
    assert.equal(getDriverVehicleLicenseIssue({ licenseType: codes }, { type: 'TRICYCLE' }), '');
  }
  for (const codes of ['', 'A1,INVALID', 'C,3', 'A1C', ',C', 'C,']) {
    assert.equal(isValidDriverLicenseRestriction(codes), false);
    assert.equal(isLicenseCodeAllowedForVehicle(codes, 'TRUCK'), false);
  }
});

test('multiple codes preserve profile completeness and expiry checks', () => {
  const driver = { phone: '+639171234567', licenseNumber: 'D09-22-000984', licenseType: 'A1,C', licenseExpiry: '2099-01-01' };
  assert.equal(getDriverProfileCompletenessIssue(driver), '');
  assert.equal(getDriverProfileCompletenessIssue({ ...driver, licenseExpiry: '2000-01-01' }), 'Driver license has expired');
  assert.equal(getDriverProfileCompletenessIssue({ ...driver, licenseNumber: '' }), 'Incomplete driver license profile');
});
