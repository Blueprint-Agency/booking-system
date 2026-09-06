import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import journal from './meta/_journal.json' with { type: 'json' }

/**
 * The two ways the migration journal has silently lied, as plain functions.
 *
 * Shared by `journal.test.ts` and by the `predb:generate` guard so the suite and
 * the guard cannot drift apart — a check that only one of them enforces is a
 * check that gets discovered to be missing at the worst moment. See issue #75.
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
export const KNOWN_OUT_OF_ORDER = new Set([
  '0019_promo_code_frozen_on_purchase',
  '0021_cross_location_add_on',
])

/**
 * Every entry must move the clock forward.
 *
 * Drizzle's Postgres migrator reads only the most recently applied row and runs
 * a migration when `lastDbMigration.created_at < migration.folderMillis`. An
 * entry whose `when` is *behind* one already applied is therefore skipped — no
 * error, no log. A fresh CI database migrates from empty and passes green
 * anyway, which is what makes it dangerous.
 */
export function findNonMonotonicEntries(): string[] {
  const problems: string[] = []
  const entries = journal.entries

  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1]!
    const current = entries[i]!
    if (KNOWN_OUT_OF_ORDER.has(current.tag)) continue
    if (current.when > previous.when) continue

    problems.push(
      `${current.tag} (when ${current.when}) is not after ${previous.tag} (when ${previous.when}). ` +
        `Drizzle would skip it silently on any database that already has ${previous.tag}. ` +
        `Raise its "when" above the previous entry's in meta/_journal.json.`,
    )
  }

  return problems
}

/**
 * No entry may be dated ahead of the wall clock.
 *
 * This is the check that has to run *before* `drizzle-kit generate`, because it
 * is the one that prevents the damage rather than reporting it. Generate stamps
 * a new entry with `Date.now()`; if any existing entry is in the future, the new
 * one lands behind it and is silently skipped. That is exactly how 0037 became a
 * no-op on staging and production (#73).
 */
export function findFutureDatedEntries(now: number = Date.now()): string[] {
  return journal.entries
    .filter(entry => entry.when > now)
    .map(
      entry =>
        `${entry.tag} is dated in the future (${new Date(entry.when).toISOString()}). ` +
        `The next generated migration will be stamped with the current time, land behind it, ` +
        `and be silently skipped.`,
    )
}

/** A journal entry with no `.sql`, or a `.sql` with no entry — either never runs as written. */
export function findOrphanedMigrations(): string[] {
  const problems: string[] = []
  const onDisk = new Set(
    readdirSync(here)
      .filter(name => name.endsWith('.sql'))
      .map(name => name.replace(/\.sql$/, '')),
  )
  const inJournal = new Set(journal.entries.map(e => e.tag))

  for (const tag of inJournal) {
    if (!onDisk.has(tag)) problems.push(`${tag} is in the journal but has no ${tag}.sql`)
  }
  for (const tag of onDisk) {
    if (!inJournal.has(tag)) {
      problems.push(`${tag}.sql is on disk but not in the journal, so it never runs`)
    }
  }

  return problems
}

/** `idx` is positional; a gap or a duplicate means the journal was hand-edited wrongly. */
export function findMisnumberedEntries(): string[] {
  return journal.entries.flatMap((entry, i) =>
    entry.idx === i ? [] : [`${entry.tag} is at position ${i} but claims idx ${entry.idx}`],
  )
}
