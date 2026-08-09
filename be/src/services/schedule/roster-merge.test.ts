import assert from 'node:assert'
import { mergeRoster, type RosterEntry, type RosterPatch } from './roster-merge'

/** `roster('A:main=50', 'B=30', 'C')` — main first, `=` gives pay, bare = unpriced. */
const roster = (...spec: string[]): RosterEntry[] =>
  spec.map(s => {
    const [who, pay] = s.split('=')
    const [instructorId, role] = (who ?? '').split(':')
    return {
      instructorId: instructorId!,
      role: role === 'main' ? 'main' : 'supporting',
      paySgd: pay === undefined ? null : Number(pay),
    }
  })

const merged = (existing: RosterEntry[], patch: RosterPatch): RosterEntry[] => {
  const r = mergeRoster(existing, patch)
  assert.ok(r.ok, `expected merge to succeed, refused: ${r.ok ? '' : r.refusal}`)
  return r.roster
}

const refusal = (existing: RosterEntry[], patch: RosterPatch): string | undefined => {
  const r = mergeRoster(existing, patch)
  return r.ok ? undefined : r.refusal
}

// --- an instructor who stays keeps their pay when no value is supplied -------
// This is the live defect: pay entered on Payroll, roster re-saved from Schedule.
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30', 'C=45'), { supporting: [{ instructorId: 'B' }, { instructorId: 'C' }] }),
  roster('A:main=100', 'B=30', 'C=45'),
)

// ...and adding a third instructor doesn't disturb the two already priced
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), {
    supporting: [{ instructorId: 'B' }, { instructorId: 'D' }],
  }),
  roster('A:main=100', 'B=30', 'D'),
)

// --- an instructor who stays gets the new value when one is supplied ---------
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { supporting: [{ instructorId: 'B', paySgd: 55 }] }),
  roster('A:main=100', 'B=55'),
)

// --- an instructor who leaves has their pay removed -------------------------
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30', 'C=45'), { supporting: [{ instructorId: 'C' }] }),
  roster('A:main=100', 'C=45'),
)
// emptying the roster entirely
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { supporting: [] }),
  roster('A:main=100'),
)
// ...and coming back later starts unpriced, not at the old number
assert.deepStrictEqual(
  merged(merged(roster('A:main=100', 'B=30'), { supporting: [] }), {
    supporting: [{ instructorId: 'B' }],
  }),
  roster('A:main=100', 'B'),
)

// --- explicitly clearing pay does clear it ----------------------------------
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { supporting: [{ instructorId: 'B', paySgd: null }] }),
  roster('A:main=100', 'B'),
)
assert.deepStrictEqual(
  merged(roster('A:main=100'), { main: { paySgd: null } }),
  roster('A:main'),
)
// zero is a price, not an absence
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { supporting: [{ instructorId: 'B', paySgd: 0 }] }),
  roster('A:main=100', 'B=0'),
)

// --- duplicates in the input collapse ---------------------------------------
assert.deepStrictEqual(
  merged(roster('A:main=100'), {
    supporting: [{ instructorId: 'B' }, { instructorId: 'B' }, { instructorId: 'C' }],
  }),
  roster('A:main=100', 'B', 'C'),
)
// a supplied price survives a bare repeat of the same instructor
assert.deepStrictEqual(
  merged(roster('A:main=100'), {
    supporting: [{ instructorId: 'B', paySgd: 20 }, { instructorId: 'B' }],
  }),
  roster('A:main=100', 'B=20'),
)
// two supplied prices for one instructor — the last one wins
assert.deepStrictEqual(
  merged(roster('A:main=100'), {
    supporting: [{ instructorId: 'B', paySgd: 20 }, { instructorId: 'B', paySgd: 25 }],
  }),
  roster('A:main=100', 'B=25'),
)

// --- the main instructor cannot also be supporting --------------------------
assert.strictEqual(
  refusal(roster('A:main=100'), { supporting: [{ instructorId: 'A' }] }),
  'supporting_instructor_duplicates_main',
)
// ...including when the main instructor is the one being changed
assert.strictEqual(
  refusal(roster('A:main=100', 'B=30'), { main: { instructorId: 'C' }, supporting: [{ instructorId: 'C' }] }),
  'supporting_instructor_duplicates_main',
)
// ...and when the new main is already on the untouched supporting list
assert.strictEqual(
  refusal(roster('A:main=100', 'B=30'), { main: { instructorId: 'B' } }),
  'supporting_instructor_duplicates_main',
)

// --- the identifiers-only shape leaves all existing pay intact --------------
// The behaviour change this ticket is for: bare ids used to mean "pay is nothing".
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30', 'C=45'), { supportingInstructorIds: ['B', 'C'] }),
  roster('A:main=100', 'B=30', 'C=45'),
)
// reordered, with an addition — still no pay lost
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30', 'C=45'), { supportingInstructorIds: ['C', 'D', 'B'] }),
  roster('A:main=100', 'B=30', 'C=45', 'D'),
)
// and dropping one from the id list removes only that one's pay
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30', 'C=45'), { supportingInstructorIds: ['B'] }),
  roster('A:main=100', 'B=30'),
)
// the richer shape wins when a client somehow sends both
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), {
    supporting: [{ instructorId: 'B', paySgd: 7 }],
    supportingInstructorIds: ['C'],
  }),
  roster('A:main=100', 'B=7'),
)

// --- a patch that doesn't mention the supporting roster leaves it alone -----
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { main: { paySgd: 120 } }),
  roster('A:main=120', 'B=30'),
)
assert.deepStrictEqual(merged(roster('A:main=100', 'B=30'), {}), roster('A:main=100', 'B=30'))

// --- the main role ----------------------------------------------------------
// changing main: the new holder starts unpriced rather than inheriting the
// departing instructor's number, which was recorded against a different person
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { main: { instructorId: 'Z' } }),
  roster('Z:main', 'B=30'),
)
// ...unless a value is supplied with the change
assert.deepStrictEqual(
  merged(roster('A:main=100'), { main: { instructorId: 'Z', paySgd: 90 } }),
  roster('Z:main=90'),
)
// promotion: an instructor already on the event carries their own pay into the
// main role, and vacates the supporting list in the same patch
assert.deepStrictEqual(
  merged(roster('A:main=100', 'B=30'), { main: { instructorId: 'B' }, supporting: [] }),
  roster('B:main=30'),
)

// --- workshops: the whole roster is rows, main included ---------------------
// Nothing above changes for them — `readRosters` hands the merge the same shape
// either way — but these are the patterns only the row-shaped kinds produce.
// Creating one: an empty roster plus a main and some bare ids.
assert.deepStrictEqual(
  merged([], { main: { instructorId: 'A' }, supportingInstructorIds: ['C', 'B'] }),
  roster('A:main', 'B', 'C'),
)
// A supporting-only edit round-trips the main row back out with its pay — this
// is the defect: the main row used to be deleted and re-inserted unpriced.
assert.deepStrictEqual(
  merged(roster('A:main=200', 'B=30'), { supportingInstructorIds: ['B', 'C'] }),
  roster('A:main=200', 'B=30', 'C'),
)
// Re-pricing the main row alone leaves the supporting rows untouched.
assert.deepStrictEqual(
  merged(roster('A:main=200', 'B=30'), { main: { paySgd: 250 } }),
  roster('A:main=250', 'B=30'),
)

// --- corporate sessions: a kind that records no pay at all -------------------
// Neither table has a pay column, so every entry reads back unpriced and every
// patch is ids-only. Nothing here should ever invent a number.
// Creating one: the main is already on the event row, the patch is bare ids.
assert.deepStrictEqual(
  merged(roster('A:main'), { supportingInstructorIds: ['C', 'B', 'C'] }),
  roster('A:main', 'B', 'C'),
)
// Swapping the main on an all-unpriced roster, supporting list untouched.
assert.deepStrictEqual(
  merged(roster('A:main', 'B'), { main: { instructorId: 'Z' } }),
  roster('Z:main', 'B'),
)
// ...and the shared refusal still applies when nobody has a price.
assert.strictEqual(
  refusal(roster('A:main', 'B'), { main: { instructorId: 'B' } }),
  'supporting_instructor_duplicates_main',
)

console.log('roster-merge.test ok')
