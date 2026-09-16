# Database migrations

Drizzle-managed. The migration `.sql` files and their `meta/*_snapshot.json` are a
matched pair — Drizzle diffs the schema (`src/db/schema/`) against the **latest
snapshot** to figure out what changed. If the snapshots drift out of sync with the
SQL, `drizzle-kit generate` re-emits already-applied changes as phantom migrations
that then fail to apply ("type already exists", "column already exists", …).

`0000_wandering_swordsman` is a squashed baseline regenerated from the schema on
2026-06-06. The pre-launch history (old 0000–0012, including one-time data backfills)
was collapsed into it because no deployed database needed that history preserved.

## Golden rules

0. **Migrations only add.** A migration may add a table, a nullable column (or one with
   a default), an index, an enum value. It does not rename or drop anything the build
   currently running still reads. Two reasons, both about the deploy:

   - The deploy migrates **before** it swaps the container, so for a minute the old build
     serves against the new schema.
   - Rolling back (`docs/md/deployment.md` § Rolling back the backend) moves the code,
     never the data — the previous image runs against the already-migrated database.

   Both are harmless when the migration only added: an older build ignores a column it
   does not know. Both break when it renamed or dropped: the older build queries a column
   that is gone.

   A rename or a drop is therefore **expand → backfill → contract**, over at least two
   deploys:

   1. **Expand** — add the new column/table beside the old one. Ship code that writes
      both and reads the new one where it is filled.
   2. **Backfill** — copy the old data across (a `--custom` migration; see rule 3).
   3. **Contract** — drop the old column/table, in a **later migration shipped in a later
      deploy**, once no running build and no `PREVIOUS_IMAGE_TAG` reads it.

   Never expand and contract in the same migration or the same deploy. The CI `drift` job
   checks that the schema and the migrations agree; it cannot check this — review does.

1. **`generate` is never automatic.** `make init` only runs `db:migrate` + `db:seed`.
   Never add `db:generate` to an automated target — it would regenerate against the
   live schema on every run.

2. **Pure DDL change** (add a column, table, index, enum value with no data
   backfill — or the contract step of rule 0): edit `src/db/schema/`, then:
   ```
   npm run db:generate     # writes the next NNNN_*.sql + snapshot
   npm run db:migrate
   ```

3. **Data migration / backfill / non-trivial enum reshape** (anything needing custom
   SQL — `USING` casts, `UPDATE … SET`, conditional logic): use `--custom`, but know
   exactly what it does.
   ```
   npx drizzle-kit generate --custom --name=describe_change
   ```
   This emits an **empty** `NNNN_describe_change.sql` plus a snapshot that is the
   **previous snapshot copied verbatim**, with only `id`/`prevId` changed. It does
   **not** read `src/db/schema/`. So a `--custom` migration whose hand-written SQL
   also changes the schema (adds/drops a column, table or enum value) leaves the
   snapshot describing the *pre-change* database, and the next `npm run db:generate`
   re-emits that same change as a phantom migration — exactly the 0008–0012 drift
   this file exists to prevent. (Verified the hard way, 2026-08. The claim that
   `--custom` "writes the snapshot for you" was wrong and used to live here.)

   Two ways to keep the chain honest:

   - **Preferred — split it.** Put the schema change in a normal `db:generate`
     migration (which writes a true snapshot) and the data work in a separate
     `--custom` one. A backfill that changes no schema is exactly the case where
     copying the previous snapshot is correct. Where a backfill has to sit *between*
     two DDL steps (add columns → copy data → drop old columns), that is three
     migrations: generated, custom, generated.
   - **One file anyway.** Write the custom SQL, then reconcile the snapshot by hand:
     with `src/db/schema/` already at the end state, run `npm run db:generate`, keep
     the snapshot it wrote as your migration's snapshot (fixing `id`/`prevId`), fold
     any SQL it emitted into your custom file, and delete the generated pair.

   **The gate, either way:** `npm run db:generate` must answer *"No schema changes,
   nothing to migrate"* before you commit. If it wants to emit anything, the chain is
   already out of sync — fix it on your branch, not on the next person's.

   Do **not** create `.sql` files by hand without a paired snapshot — that is the
   other half of what caused the 0008–0012 drift.

   **Check the `when` too.** A `--custom` migration's journal entry is stamped with
   `Date.now()`, and nothing about `--custom` checks it against the previous entry.
   Drizzle's Postgres migrator reads only the most recently applied row and runs a
   migration when `lastDbMigration.created_at < migration.folderMillis` — so an entry
   whose `when` is *behind* one already applied is **silently skipped**: no error, no
   log, and a fresh CI database migrates from empty and passes green anyway. That is
   how `0037` became a no-op on staging and production (#73). It happens whenever an
   earlier `when` was hand-set ahead of wall-clock time, because the next generated
   entry then lands behind it. **Never hand-set a `when` into the future.**
   `journal.test.ts` fails on both halves — a non-monotonic entry and a future-dated
   one — with `0019` and `0021` grandfathered as knowingly out of order.

   **`predb:generate` refuses to generate against a journal that is already
   future-dated.** That is the only moment the check can prevent anything rather than
   report it: `generate` stamps the new entry with `Date.now()`, so if nothing is dated
   ahead, the new entry cannot land behind. Both the guard and the test read
   `journal-checks.ts`, so they cannot drift apart. `npx drizzle-kit generate --custom`
   bypasses npm scripts and therefore bypasses the guard — on that path the `when` is
   yours to check, and the test is what catches you.

4. **Review the generated SQL before committing.** Drizzle's auto-rename detection
   guesses (drop+add vs rename); when it asks, or when the diff looks wrong, fix it.

## Resetting local dev

```
make reset   # docker compose down -v  (wipes the volume)
make init    # ensure-db → migrate → seed
```
