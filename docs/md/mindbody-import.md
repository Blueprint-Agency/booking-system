# Mindbody import runbook

## 0. Snapshot first. Every time, including a dry run.

```bash
ssh bp-bpvps2 'docker exec backup /app/bin/backup.sh booking-prod'       # exit 3 = green
ssh bp-bpvps2 'docker exec backup restic snapshots --tag booking-prod --latest 1'   # write the id down
```

Use `booking-staging` instead when importing into staging. **Exit 3 is success** (a one-target
run); anything else — stop, and do not import. Write the snapshot id in the import's ticket
before step 1.

If the import goes wrong, that snapshot is the way back:

```bash
ssh bp-bpvps2
docker exec backup /app/bin/restore-live.sh booking-prod <id> --confirm booking-prod
```

It restores beside live, snapshots live again, then swaps the two in one transaction; the
pre-restore database is kept until dropped. What it does and every refusal:
infrastructure repo, [`docs/backup-restore.md`](https://github.com/Blueprint-Agency/infrastructure/blob/main/docs/backup-restore.md),
"Restore to live".

## 1. The import

_To be written with the import itself: mapping, import script, dry run, reconciliation gate,
invitation batches and rollback window — issue #130. Keep step 0 at the top of this file._
