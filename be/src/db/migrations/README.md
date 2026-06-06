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
   SQL — `USING` casts, `UPDATE … SET`, conditional logic): use `--custom` so Drizzle
   writes the snapshot for you and the chain stays in sync:
   ```
   npx drizzle-kit generate --custom --name=describe_change
   ```
   This emits an **empty** `NNNN_describe_change.sql` plus a snapshot reflecting the
   current schema. Hand-write the SQL into that file. Do **not** create `.sql` files
   by hand without a paired snapshot — that is what caused the 0008–0012 drift.

4. **Review the generated SQL before committing.** Drizzle's auto-rename detection
   guesses (drop+add vs rename); when it asks, or when the diff looks wrong, fix it.

## Resetting local dev

```
make reset   # docker compose down -v  (wipes the volume)
make init    # ensure-db → migrate → seed
```
