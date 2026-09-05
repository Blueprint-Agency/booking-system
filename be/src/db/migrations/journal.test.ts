import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import journal from './meta/_journal.json' with { type: 'json' }

/**
 * The migration journal, checked for the two ways it has silently lied.
 *
 * Both were found the hard way — see issue #75 — and neither announces itself:
 * one skips a migration without an error, the other invents one that fails to
 * apply. A test is the cheapest place to catch either, because both are visible
 * in a JSON file and neither is visible on a fresh CI database.
 */

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Two entries whose `when` runs backwards, knowingly left alone.
 *
 * Both were applied long ago on every database, so renumbering them now would
 * change a tag that `__drizzle_migrations` already records. They are harmless
 * where they are: the migrations after them have later values, so nothing is
 * skipped. New entries do not get this latitude.
 */
const KNOWN_OUT_OF_ORDER = new Set(['0019_promo_code_frozen_on_purchase', '0021_cross_location_add_on'])

test('every migration after the historic pair moves the clock forward', () => {
  // Drizzle's Postgres migrator reads only the most recently applied row and
  // applies a migration when `lastDbMigration.created_at < migration.folderMillis`.
  // An entry whose `when` is *behind* one already applied is therefore skipped —
  // no error, no log. On a fresh CI database everything migrates from empty and
  // the suite still passes, which is what makes it dangerous.
  const entries = journal.entries
  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1]!
    const current = entries[i]!
    if (KNOWN_OUT_OF_ORDER.has(current.tag)) continue

    assert.ok(
      current.when > previous.when,
      `${current.tag} (when ${current.when}) is not after ${previous.tag} (when ${previous.when}). ` +
        `Drizzle would skip it silently on any database that already has ${previous.tag}. ` +
        `Raise its "when" above the previous entry's in meta/_journal.json.`,
    )
  }
})

test('a hand-set `when` never runs ahead of the wall clock', () => {
  // The other half of the same trap. `drizzle-kit generate` stamps a new entry
  // with `Date.now()`, so an entry dated in the future guarantees that the *next*
  // migration lands behind it and is skipped. That is exactly how 0037 came to
  // be a no-op on staging and production.
  const now = Date.now()
  for (const entry of journal.entries) {
    assert.ok(
      entry.when <= now,
      `${entry.tag} is dated in the future (${new Date(entry.when).toISOString()}). ` +
        `The next generated migration will be stamped with the current time, land behind it, ` +
        `and be silently skipped.`,
    )
  }
})

test('every journal entry has its SQL file, and every SQL file its entry', () => {
  // The migrator loads `<tag>.sql`, so a renamed file with an unrenamed tag
  // fails at deploy time rather than here.
  const onDisk = new Set(
    readdirSync(here)
      .filter(name => name.endsWith('.sql'))
      .map(name => name.replace(/\.sql$/, '')),
  )
  const inJournal = new Set(journal.entries.map(e => e.tag))

  for (const tag of inJournal) {
    assert.ok(onDisk.has(tag), `${tag} is in the journal but has no ${tag}.sql`)
  }
  for (const tag of onDisk) {
    assert.ok(inJournal.has(tag), `${tag}.sql is on disk but not in the journal, so it never runs`)
  }
})

test('indexes are unique and consecutive', () => {
  journal.entries.forEach((entry, i) => {
    assert.equal(entry.idx, i, `${entry.tag} is at position ${i} but claims idx ${entry.idx}`)
  })
})

// Referenced so the path is exercised rather than merely computed.
void join(here, 'meta')
