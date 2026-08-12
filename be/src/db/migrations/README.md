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

1. **`generate` is never automatic.** `make init` only runs `db:migrate` + `db:seed`.
   Never add `db:generate` to an automated target — it would regenerate against the
   live schema on every run.

2. **Pure DDL change** (add/drop column, table, index, enum value with no data
   backfill): edit `src/db/schema/`, then:
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

4. **Review the generated SQL before committing.** Drizzle's auto-rename detection
   guesses (drop+add vs rename); when it asks, or when the diff looks wrong, fix it.

## Resetting local dev

```
make reset   # docker compose down -v  (wipes the volume)
make init    # ensure-db → migrate → seed
```
