import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normaliseClassPassLocation } from './location-name'

test('CPS-20 two spellings of a ClassPass location name that differ only in case, spaces or dash characters normalise alike', () => {
  const spellings = [
    'Northwind-Harbour Street',
    'Northwind - Harbour Street',
    'northwind – harbour  street',
    '  NORTHWIND—Harbour\tStreet ',
    'Northwind -Harbour Street',
  ]
  const normalised = new Set(spellings.map(normaliseClassPassLocation))
  assert.deepEqual([...normalised], ['northwind - harbour street'])

  // A name ClassPass cut short is a name like any other.
  assert.equal(normaliseClassPassLocation('Northwind -'), 'northwind -')
  assert.equal(normaliseClassPassLocation('Northwind–'), 'northwind -')

  // Different words stay different.
  assert.notEqual(normaliseClassPassLocation('Northwind - Harbour'), normaliseClassPassLocation('Northwind - Harbor'))
})
