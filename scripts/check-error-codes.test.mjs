import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findDrift, formatDrift, readCatalogueKeys } from './check-error-codes.mjs'

test('three matching key sets report no drift', () => {
  const keys = ['not_found', 'tenant_mismatch']
  const drift = findDrift({ be: keys, 'fe-client': keys, 'fe-portal': keys })
  assert.deepEqual(drift, [])
  assert.equal(formatDrift(drift), '')
})

test('a frontend without a backend code reports it missing; one with an unknown code reports it extra', () => {
  const drift = findDrift({
    be: ['not_found', 'tenant_mismatch', 'tenant_required'],
    'fe-client': ['not_found', 'tenant_mismatch'],
    'fe-portal': ['not_found', 'tenant_mismatch', 'tenant_required', 'tenant_gone'],
  })
  assert.deepEqual(drift, [
    { app: 'fe-client', missing: ['tenant_required'], extra: [] },
    { app: 'fe-portal', missing: [], extra: ['tenant_gone'] },
  ])
  assert.equal(
    formatDrift(drift),
    [
      'fe-client is missing: tenant_required',
      'fe-portal has extra: tenant_gone',
    ].join('\n'),
  )
})

test('an app both missing and extra reports both', () => {
  const drift = findDrift({ be: ['a', 'b'], 'fe-client': ['a', 'c'], 'fe-portal': ['a', 'b'] })
  assert.deepEqual(drift, [{ app: 'fe-client', missing: ['b'], extra: ['c'] }])
  assert.equal(formatDrift(drift), 'fe-client is missing: b\nfe-client has extra: c')
})

test('reads the keys of a catalogue in either quote style, ignoring comments', () => {
  const be = `/** not_a_key: 'x', */\nexport const ERROR_CODES = {\n  not_found: 'not_found',\n  tenant_mismatch: 'tenant_mismatch',\n} as const\n`
  const fe = `export const ERROR_CODES = {\n  not_found: "not_found",\n  tenant_mismatch: "tenant_mismatch",\n} as const;\n`
  assert.deepEqual(readCatalogueKeys(be), ['not_found', 'tenant_mismatch'])
  assert.deepEqual(readCatalogueKeys(fe), ['not_found', 'tenant_mismatch'])
})

test('a line the reader cannot read is an error, not a silently dropped key', () => {
  const twoOnOneLine = `export const ERROR_CODES = {\n  a: 'a', b: 'b',\n} as const\n`
  const valueDiffers = `export const ERROR_CODES = {\n  a: 'b',\n} as const\n`
  assert.throws(() => readCatalogueKeys(twoOnOneLine), /a: 'a', b: 'b',/)
  assert.throws(() => readCatalogueKeys(valueDiffers), /a: 'b',/)
})

test('a file with no catalogue object is an error, not an empty set', () => {
  assert.throws(() => readCatalogueKeys('export const X = 1\n'), /ERROR_CODES/)
})
