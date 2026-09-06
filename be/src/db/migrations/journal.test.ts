import test from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWN_OUT_OF_ORDER,
  findFutureDatedEntries,
  findMisnumberedEntries,
  findNonMonotonicEntries,
  findOrphanedMigrations,
} from './journal-checks'
import journal from './meta/_journal.json' with { type: 'json' }

/**
 * The migration journal, checked for the two ways it has silently lied.
 *
 * Both were found the hard way — see issue #75 — and neither announces itself:
 * one skips a migration without an error, the other invents one that fails to
 * apply. A test is the cheapest place to catch either, because both are visible
 * in a JSON file and neither is visible on a fresh CI database.
 *
 * The predicates live in `journal-checks.ts` because `predb:generate` runs them
 * too. A guard the suite and the tooling implement separately is a guard that
 * eventually only one of them has.
 */

test('every migration after the historic pair moves the clock forward', () => {
  assert.deepEqual(findNonMonotonicEntries(), [])
})

test('a hand-set `when` never runs ahead of the wall clock', () => {
  assert.deepEqual(findFutureDatedEntries(), [])
})

test('every journal entry has its SQL file, and every SQL file its entry', () => {
  assert.deepEqual(findOrphanedMigrations(), [])
})

test('indexes are unique and consecutive', () => {
  assert.deepEqual(findMisnumberedEntries(), [])
})

test('the monotonic check actually fires on an entry that runs backwards', () => {
  // Guards the guard. Every other assertion here passes on an empty result, so
  // a predicate that silently stopped looking would look identical to a healthy
  // journal. The two grandfathered entries are the one place the repository has
  // a real violation to point at, so they double as the fixture.
  const entries = journal.entries
  const grandfathered = entries.filter(e => KNOWN_OUT_OF_ORDER.has(e.tag))

  assert.equal(grandfathered.length, 2, 'the historic out-of-order pair should still be present')

  for (const entry of grandfathered) {
    const previous = entries[entries.indexOf(entry) - 1]
    assert.ok(previous, `${entry.tag} should not be the first entry`)
    assert.ok(
      entry.when < previous.when,
      `${entry.tag} is no longer out of order — remove it from KNOWN_OUT_OF_ORDER ` +
        `rather than leaving an exemption that hides a future violation`,
    )
  }
})
