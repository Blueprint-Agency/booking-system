import assert from 'node:assert'
import { combinedInstructorIds, lineupOf, lineupsOf } from './lineup'
import type { RosterEntry } from './roster-merge'

const entry = (instructorId: string, role: RosterEntry['role']): RosterEntry => ({
  instructorId,
  role,
  paySgd: null,
})

// --- the ordinary case: main leads, supporting follow in roster order --------
assert.deepStrictEqual(
  lineupOf([entry('A', 'main'), entry('B', 'supporting'), entry('C', 'supporting')]),
  {
    mainInstructorId: 'A',
    supportingInstructorIds: ['B', 'C'],
    instructorIds: ['A', 'B', 'C'],
  },
)

// --- no main: the combined list is the supporting list, NOT [null, ...] ------
// Corporate/workshop rosters can legitimately be missing their main row.
assert.deepStrictEqual(lineupOf([entry('B', 'supporting')]), {
  mainInstructorId: null,
  supportingInstructorIds: ['B'],
  instructorIds: ['B'],
})

assert.deepStrictEqual(lineupOf([]), {
  mainInstructorId: null,
  supportingInstructorIds: [],
  instructorIds: [],
})

// --- the roster's order is kept as-is; lineupOf never re-sorts ---------------
assert.deepStrictEqual(
  lineupOf([entry('Z', 'main'), entry('C', 'supporting'), entry('A', 'supporting')]).instructorIds,
  ['Z', 'C', 'A'],
)

// --- the batch form: an event with nobody supporting still gets an entry -----
// (the reads it replaced returned no key at all; every caller reads `?? []`)
assert.deepStrictEqual(
  [
    ...lineupsOf(
      new Map([
        ['e1', [entry('A', 'main'), entry('B', 'supporting')]],
        ['e2', [entry('A', 'main')]],
      ]),
    ),
  ].map(([id, l]) => [id, l.supportingInstructorIds]),
  [
    ['e1', ['B']],
    ['e2', []],
  ],
)

// --- the combined list copies, so a caller can't mutate the supporting list --
const supporting = ['B']
const combined = combinedInstructorIds(null, supporting)
combined.push('C')
assert.deepStrictEqual(supporting, ['B'])

console.log('lineup.test ok')
