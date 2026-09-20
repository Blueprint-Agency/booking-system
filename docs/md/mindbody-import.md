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

## The transform (reports → studio archive)

The backend turns a folder of downloaded Mindbody reports plus a **studio config** into a zip
the super portal's import reads (`be/src/mindbody/`). It needs no database and no backend
environment. The reports, the config and everything it writes name real people: keep them
beside the downloads, never in this repository.

```bash
cd be
# 1. A config pre-filled from the reports. Fill in every null.
npm run mindbody -- starter --reports <downloads dir> --out <config.json>
# 2. Provision the Tenant in the super portal WITHOUT a first admin; copy its id.
# 3. The archive, for that Tenant.
npm run mindbody -- transform --reports <downloads dir> --config <config.json> --tenant <tenant id> --out <studio.zip>
```

- `transform` refuses to run while a field is open, and lists every one by name.
- Beside the zip it writes `<studio>.ids.json` (Mindbody key → platform id, per table) and
  `<studio>.preflight.md` (members with no email, and emails several members share: who keeps
  the address, who gets a placeholder on `no-email.invalid`). Send the preflight to the studio.
- The Tenant must be provisioned with the config's `studio.slug`: the import refuses an archive
  built for another slug, because its email links name that slug.
- Staff invitations expire 7 days after `asOf` (the download time). Importing later is fine:
  resend them from the portal's staff page, which extends the link.
- Same reports + same config + same Tenant id → the same zip, byte for byte. Row ids are
  UUID v5 of the Tenant id and the Mindbody key; invitation tokens are keyed by the config's
  `secret`, which `starter` writes once at random.
- Reads today: Mailing Lists (Mailing List), Referral Types (detail files: creation date),
  Retention Management (gender), Phone Book (staff).
- Writes: settings, Locations, Rooms, Class Types, policy, PT booking config, all email
  templates, every member profile, and staff — the owner (`studio.ownerEmail`) an active Admin,
  other migrated staff pending with an invitation to resend from the portal, `archived` teachers
  with a placeholder email.

The archive's manifest carries `ensureAccounts: true`. On import that makes the importer create
or reuse the sign-in account of every member and staff row by email, inside the import's
transaction; a failed import leaves no accounts behind. An archive without the flag (every
export) still needs each row to name its account, as before.

## 1. The import

_To be written with the import itself: mapping, import script, dry run, reconciliation gate,
invitation batches and rollback window — issue #130. Keep step 0 at the top of this file._
