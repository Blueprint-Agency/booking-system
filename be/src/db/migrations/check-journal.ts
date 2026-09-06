/**
 * Refuses to let `npm run db:generate` run against a journal that would make the
 * migration it is about to write a no-op.
 *
 * Wired as `predb:generate`, which is the only moment the check can *prevent*
 * anything: generate stamps the new entry with `Date.now()`, so an existing
 * entry dated in the future guarantees the new one lands behind it and is
 * silently skipped by Drizzle's migrator. Afterwards the damage is written to
 * disk and has to be noticed.
 *
 * `journal.test.ts` asserts the same properties from the suite. This exists
 * because the suite is not run on every branch that touches the schema, and
 * because a developer generating a migration is exactly the person who needs to
 * hear about it. Both read `journal-checks.ts`, so they cannot disagree.
 *
 * `npx drizzle-kit generate --custom` bypasses npm scripts entirely and so
 * bypasses this — that path is covered by the README and the test.
 */

import {
  findFutureDatedEntries,
  findMisnumberedEntries,
  findNonMonotonicEntries,
  findOrphanedMigrations,
} from './journal-checks'

const problems = [
  ...findFutureDatedEntries(),
  ...findNonMonotonicEntries(),
  ...findOrphanedMigrations(),
  ...findMisnumberedEntries(),
]

if (problems.length > 0) {
  console.error('\nThe migration journal is not safe to generate against:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\nFix meta/_journal.json before generating. See src/db/migrations/README.md §3.\n',
  )
  process.exit(1)
}
