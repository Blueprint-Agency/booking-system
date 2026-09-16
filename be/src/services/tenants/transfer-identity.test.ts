import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildIdentityMap, remapRow, remapValue } from './transfer-identity'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

/** Deterministic ids, so a test can name what a row should have become. */
function counter() {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}
const nth = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('every row id gets a fresh id, in table order', () => {
  const map = buildIdentityMap(
    ['locations', 'rooms'],
    { locations: [{ id: A }], rooms: [{ id: B }] },
    counter(),
  )
  assert.equal(map.get(A), nth(1))
  assert.equal(map.get(B), nth(2))
  assert.equal(map.size, 2)
})

test('a table with no rows, and one absent from the archive, contribute nothing', () => {
  const map = buildIdentityMap(['locations', 'rooms'], { locations: [] }, counter())
  assert.equal(map.size, 0)
})

test('a row with no id column is skipped — its key is other tables ids', () => {
  // `workshop_instructors` is keyed by (workshop_id, instructor_id). It needs no
  // entry: rewriting those two columns is what moves it.
  const map = buildIdentityMap(
    ['workshop_instructors'],
    { workshop_instructors: [{ workshop_id: A, instructor_id: B }] },
    counter(),
  )
  assert.equal(map.size, 0)
})

test('references are rewritten and unknown uuids are left alone', () => {
  const map = new Map([[A, B]])
  assert.equal(remapValue(A, map), B)
  // A tenant id, a Clerk id, free text: not in the map, so not touched.
  assert.equal(remapValue(C, map), C)
  assert.equal(remapValue('user_2abc', map), 'user_2abc')
  assert.equal(remapValue(null, map), null)
  assert.equal(remapValue(42, map), 42)
})

test('uuid arrays are rewritten element by element', () => {
  // `staff_users.granted_location_ids` — a reference like any other.
  const map = new Map([[A, B]])
  assert.deepEqual(remapValue([A, C], map), [B, C])
})

test('ids inside a jsonb payload move with the row', () => {
  const map = new Map([[A, B]])
  assert.deepEqual(remapValue({ before: { client_id: A }, note: 'kept' }, map), {
    before: { client_id: B },
    note: 'kept',
  })
})

test('a Date is a value, not a container, and survives unchanged', () => {
  const when = new Date('2026-01-01T00:00:00.000Z')
  assert.equal(remapValue(when, new Map([[A, B]])), when)
})

test('an empty map returns the row unchanged, and never the same object', () => {
  const row = { id: A, name: 'Studio' }
  const out = remapRow(row, new Map())
  assert.deepEqual(out, row)
  assert.notEqual(out, row)
})

test('a self-reference is rewritten to the row s own new id', () => {
  // The three self-referencing tables `transfer-order.ts` defers: the row points
  // at itself, so both ends have to land on the same new id.
  const map = buildIdentityMap(['inbox_items'], { inbox_items: [{ id: A, parent_id: A }] }, counter())
  assert.deepEqual(remapRow({ id: A, parent_id: A }, map), {
    id: nth(1),
    parent_id: nth(1),
  })
})
