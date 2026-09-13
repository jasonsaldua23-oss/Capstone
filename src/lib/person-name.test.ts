import assert from 'node:assert/strict'
import test from 'node:test'

import { PERSON_NAME_NUMBER_ERROR, validatePersonName } from './person-name.ts'

test('rejects numbers in any person-name part', () => {
  assert.equal(validatePersonName('Juan', '123', 'Dela Cruz'), PERSON_NAME_NUMBER_ERROR)
  assert.equal(validatePersonName('Juan2', '', 'Dela Cruz'), PERSON_NAME_NUMBER_ERROR)
})

test('accepts letters, spaces, punctuation, and empty optional parts', () => {
  assert.equal(validatePersonName("Anne-Marie", '', 'Dela Cruz', 'Jr.'), null)
})
