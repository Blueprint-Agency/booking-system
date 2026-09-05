import test from 'node:test'
import assert from 'node:assert/strict'
import { orderTables, type ForeignKey } from './transfer-order'

const fk = (child: string, parent: string, column = `${parent}_id`, required = false): ForeignKey => ({
  child,
  parent,
  column,
  required,
})

/** Every parent appears before every child that names it. */
function assertParentsFirst(order: string[], edges: ForeignKey[]) {
  const at = new Map(order.map((t, i) => [t, i]))
  for (const e of edges) {
    if (e.child === e.parent) continue
    assert.ok(
      at.get(e.parent)! < at.get(e.child)!,
      `${e.parent} must be written before ${e.child}`,
    )
  }
}

test('a table is written after the tables it points at', () => {
  const edges = [fk('bookings', 'clients'), fk('bookings', 'classes'), fk('classes', 'locations')]
  const { order, unbreakable } = orderTables(
    ['bookings', 'clients', 'classes', 'locations'],
    edges,
  )
  assert.deepEqual(unbreakable, [])
  assert.equal(order.length, 4)
  assertParentsFirst(order, edges)
})

test('every table given comes back exactly once', () => {
  const tables = ['a', 'b', 'c', 'd']
  const { order } = orderTables(tables, [fk('b', 'a'), fk('c', 'b'), fk('d', 'c')])
  assert.deepEqual([...order].sort(), tables)
})

test('a table that points at itself defers that column instead of ordering', () => {
  // The real case: clients.referred_by_client_id. No ordering of tables can
  // help, because the rows are in the same table.
  const { order, deferred, unbreakable } = orderTables(
    ['clients'],
    [fk('clients', 'clients', 'referred_by_client_id')],
  )
  assert.deepEqual(order, ['clients'])
  assert.deepEqual(deferred, { clients: ['referred_by_client_id'] })
  assert.deepEqual(unbreakable, [])
})

test('a cycle between two tables is broken on its nullable edge', () => {
  const { order, deferred, unbreakable } = orderTables(
    ['a', 'b'],
    [fk('a', 'b', 'b_id', true), fk('b', 'a', 'a_id', false)],
  )
  assert.deepEqual(unbreakable, [])
  assert.deepEqual(deferred, { b: ['a_id'] })
  // With b's reference deferred, b no longer depends on a, so a can follow it.
  assert.deepEqual(order, ['b', 'a'])
})

test('a cycle with no nullable edge is reported, not silently mis-ordered', () => {
  const { order, unbreakable } = orderTables(
    ['a', 'b'],
    [fk('a', 'b', 'b_id', true), fk('b', 'a', 'a_id', true)],
  )
  assert.deepEqual(unbreakable, [['a', 'b']])
  assert.deepEqual([...order].sort(), ['a', 'b'])
})

test('a reference to a table outside the set is not a dependency', () => {
  // `tenants` is not moved — the studio exists before its rows do — so a
  // reference to it must not make every table unorderable.
  const { order, unbreakable } = orderTables(['clients'], [fk('clients', 'tenants')])
  assert.deepEqual(order, ['clients'])
  assert.deepEqual(unbreakable, [])
})

test('the same schema always yields the same order', () => {
  const tables = ['bookings', 'clients', 'classes', 'locations']
  const edges = [fk('bookings', 'clients'), fk('bookings', 'classes'), fk('classes', 'locations')]
  const first = orderTables(tables, edges).order
  const second = orderTables([...tables].reverse(), [...edges].reverse()).order
  assert.deepEqual(first, second, 'a manifest must be comparable between two exports')
})

test('no tables is not an error', () => {
  assert.deepEqual(orderTables([], []), { order: [], deferred: {}, unbreakable: [] })
})
