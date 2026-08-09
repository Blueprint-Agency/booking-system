import assert from 'node:assert'
import { overlaps, occupies } from './occupancy'

/** `at('09:00-10:00')` → a window on 2026-01-01. */
const at = (range: string) => {
  const [from, to] = range.split('-')
  return {
    startsAt: new Date(`2026-01-01T${from}:00Z`),
    endsAt: new Date(`2026-01-01T${to}:00Z`),
  }
}

// --- the overlap rule ---

// touching but not overlapping — a 10:00 class does not clash with a 09:00-10:00 one
assert.strictEqual(overlaps(at('09:00-10:00'), at('10:00-11:00')), false)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-10:00')), false)

// clearly apart
assert.strictEqual(overlaps(at('09:00-10:00'), at('14:00-15:00')), false)

// partial overlap, both directions
assert.strictEqual(overlaps(at('09:00-10:30'), at('10:00-11:00')), true)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-10:30')), true)

// containment, both directions
assert.strictEqual(overlaps(at('09:00-12:00'), at('10:00-11:00')), true)
assert.strictEqual(overlaps(at('10:00-11:00'), at('09:00-12:00')), true)

// identical windows
assert.strictEqual(overlaps(at('10:00-11:00'), at('10:00-11:00')), true)

// zero-length windows: an instant strictly inside a booking is still inside it,
// in both directions...
assert.strictEqual(overlaps(at('10:00-10:00'), at('09:00-11:00')), true)
assert.strictEqual(overlaps(at('09:00-11:00'), at('10:00-10:00')), true)
// ...but two instants never meet, and an instant on either boundary is free
assert.strictEqual(overlaps(at('10:00-10:00'), at('10:00-10:00')), false)
assert.strictEqual(overlaps(at('10:00-10:00'), at('10:00-11:00')), false)
assert.strictEqual(overlaps(at('11:00-11:00'), at('10:00-11:00')), false)

// --- self-exclusion ---

const theClass = { kind: 'class' as const, id: 'c1', ...at('10:00-11:00') }

// with no exclusion it occupies its own window
assert.strictEqual(occupies(theClass, at('10:00-11:00')), true)

// rescheduling itself — same slot, moved slot, overlapping slot: never a conflict
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'class', id: 'c1' }), false)
assert.strictEqual(occupies(theClass, at('10:30-11:30'), { kind: 'class', id: 'c1' }), false)

// exclusion is per (kind, id) — a different id, or the same id under another
// kind, still blocks
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'class', id: 'c2' }), true)
assert.strictEqual(occupies(theClass, at('10:00-11:00'), { kind: 'pt_session', id: 'c1' }), true)

// every kind can exclude itself, uniformly
for (const kind of ['class', 'workshop_day', 'pt_session', 'corporate_session'] as const) {
  const ev = { kind, id: 'x', ...at('10:00-11:00') }
  assert.strictEqual(occupies(ev, at('10:00-11:00'), { kind, id: 'x' }), false)
  assert.strictEqual(occupies(ev, at('10:00-11:00')), true)
}

console.log('occupancy.test ok')
