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
#    --as-of is when the download finished; with it the catalogue proposal is only what is still held.
npm run mindbody -- starter --reports <downloads dir> --out <config.json> --as-of <2026-01-31T02:00:00+08:00>
# 2. Provision the Tenant in the super portal WITHOUT a first admin; copy its id.
# 3. The archive, for that Tenant.
npm run mindbody -- transform --reports <downloads dir> --config <config.json> --tenant <tenant id> --out <studio.zip>
# 4. Import the zip in the super portal, export the studio from the same page, then:
npm run mindbody -- verify --expected <studio.expected.json> --export <exported.zip>
```

- `transform` refuses to run while a field is open, and lists every one by name.
- Beside the zip it writes `<studio>.ids.json` (Mindbody key → platform id, per table),
  `<studio>.preflight.md` (members with no email, and emails several members share: who keeps
  the address, who gets a placeholder on `no-email.invalid`; what is still live in Mindbody and
  does not come across; money on account) and `<studio>.expected.json` (what the studio should
  add up to). Send the preflight to the studio.
- `verify` counts the exported studio the way `transform` counted its own archive — members,
  staff by role, live packages by kind, credits and sessions left in total and per member,
  future classes, PT sessions and workshops, and bookings in total, per member, per class and per
  workshop — lists every difference by member, by class or by workshop, and exits non-zero on any. Run it straight after the
  import, before anybody books.
- **The catalogue** (`catalogue` in the config) is one entry per Mindbody pricing option, proposed
  by `starter` from what was sold: the commonest sessions bought, activation-to-expiry spread and
  sale price. A person sets `migrate` on each — `sell` (active, at `priceSgd`), `legacy`
  (archived: honoured, not sold) or `skip` (not a package: workshop places, mat storage) — and
  corrects the rest. Merge an option and its copy by moving spellings into one entry's
  `mindbodyNames`. `transform` refuses a live holding whose option is not listed. `kind:
  "access_pass"` is no catalogue row: beside an Unlimited Plan homed elsewhere it becomes that
  plan's Cross-Location Add-On, and alone it is listed in the preflight.
- **Live packages** come from Visits Remaining (Detail): something left, and not expired on the
  day of `asOf`. The balance is the report's *Unbooked*. Per member and Family the soonest-ending
  runs with its Mindbody expiry; the others wait Dormant with the days they had left (an
  Unlimited Plan: the whole months that reach its expiry, rounded up). A member's holdings of one
  option are one package, as they are in the report, and every trial spelling is one trial. A
  trial used up long ago comes across spent and inactive, so the one-trial rule holds. A holding
  Mindbody sold with **no expiration at all** cannot be answered for by that rule, and no package
  here runs forever: it does not come across, and is listed in the preflight instead of vanishing.
- **The timetable to come** is every class on the all-teachers Staff Schedule ("Scheduled")
  that starts after `asOf`, whether or not anybody booked it. Its Class Type, Room and Location
  are matched through the config (`classTypes[].mindbodyNames`, `rooms[].mindbodyNames`,
  `locations[].mindbodyNames`), its capacity is the Room's or the Class Type's own
  (`classTypes[].capacity`, needed for a class held at an `offSiteVenues` venue, which has no
  Room), `credit_cost` is 1, and the teacher's pay is their Per Class rate from Pay Rates —
  where they have none, the class is **Unpriced** for an admin to settle. A name marked `***`
  is taught by the substitute it is filed under. Anything under a `workshopCategories` service
  category is left to the workshop import.
- **Future bookings** come from Schedule at a Glance over future dates, joined to a class on
  date, start time, class name and teacher — or, where only one class is on at that minute
  under that name, on that alone, since the two reports disagree about a covered class's teacher
  and the seat is a real one. Each seat is `confirmed`, paid by the member's running package in
  that Family — one that lasts until the class; a seat whose only package runs out first comes
  across unpaid and listed — and carrying the 1 credit it cost, so cancelling returns it
  (0 on an Unlimited Plan, which was never charged). Its code and QR token are keyed by the
  config's `secret`, so a rerun writes the same ones. A roster row under a
  `ptAppointmentNames` name is a PT appointment instead: a scheduled `pt_request` (its focus the
  `ptClassType` Class Type, made if the config has none by that name), a `pt_session` and a
  booking per member. PT pay is a percentage in Mindbody, which no report gives: Unpriced.
- **Workshops and retreats to come** are one config entry per Mindbody **service category** — a
  workshop, a retreat or a course has one of its own — proposed by `starter` for every category
  with something still to come. A person sets `migrate`, the Location, the seats per day and the
  price of each **tier** (room type: twin, single, non-resident), which Mindbody sells as pricing
  options; a deposit or a top-up sold under its own option is moved into the tier it buys
  (`tiers[].mindbodyNames`). The category must also be in `workshopCategories`, or its days would
  arrive as classes as well — `transform` refuses a config where it is not. A Workshop is written
  with one **Day** per future occurrence in the schedule report (its Room where the workshop's own
  Location has one), one Tier per room type granting every day, and its instructors from that
  report: whoever leads the most days is the main one and the rest are supporting, all Unpriced
  (Mindbody pays a workshop by agreement, which no report gives).
- **Workshop attendees** are the members holding a live entitlement on one of those pricing
  options: one `kind: 'workshop'` booking each, at the tier they bought, with `amount_paid_sgd` =
  what they paid — so it shows in the member's workshops and in Finance as workshop money on the
  day of `asOf`. Several holdings (a deposit and its balance, a twin place and a top-up to a
  single) are one booking whose amount is their sum, at the **dearest** tier held, because a top-up
  is what moves a member up; holding two tiers is a preflight line. A place is not a package, so
  no `client_packages` row is written for it and it is not listed as "not migrated"; a workshop
  with no day left to come is a preflight line instead of an empty Workshop.
- **Class Series** are proposed by `starter` from what ran at the same weekday, time, Room and
  name in each of the four weeks up to `asOf`. A person sets `migrate` on each; a confirmed one
  is written as a series whose imported classes are linked to it and whose last date is the
  last class that came across, so launch day starts with an extend and nothing is duplicated.
  Its teacher must be coming across as an active instructor, or the portal could never extend it.
- Whatever could not be matched — a booking with no class, a member not in the member list, a
  class over its capacity, a series with nothing to continue — is a line in the preflight, and
  the import goes ahead without it.
- The Tenant must be provisioned with the config's `studio.slug`: the import refuses an archive
  built for another slug, because its email links name that slug.
- Staff invitations expire 7 days after `asOf` (the download time). Importing later is fine:
  resend them from the portal's staff page, which extends the link.
- Same reports + same config + same Tenant id → the same zip, byte for byte. Row ids are
  UUID v5 of the Tenant id and the Mindbody key; invitation tokens are keyed by the config's
  `secret`, which `starter` writes once at random.
- Reads today: Mailing Lists (Mailing List), Referral Types (detail files: creation date),
  Retention Management (gender), Phone Book (staff), Visits Remaining (Detail `.xlsx`: holdings),
  Pricing Option Expirations and Big Spenders (Detail Accrual) — those two only to propose the
  catalogue — Staff Schedule (ALL, "Scheduled": the timetable), Schedule at a Glance (`.xlsx`,
  one per year: who is booked into what) and, if they were downloaded, Account Balances
  (All balances) and Pay Rates (`.xlsx`).
- Writes: settings, Locations, Rooms, Class Types, policy, PT booking config, all email
  templates, every member profile, the class and PT catalogue, every live package, staff — the owner (`studio.ownerEmail`) an active Admin,
  other migrated staff pending with an invitation to resend from the portal, `archived` teachers
  with a placeholder email — and the timetable still to come: Class Series, classes, PT requests
  and sessions, workshops with their days, tiers and instructors, and every booking on them.

The archive's manifest carries `ensureAccounts: true`. On import that makes the importer create
or reuse the sign-in account of every member and staff row by email, inside the import's
transaction; a failed import leaves no accounts behind. An archive without the flag (every
export) still needs each row to name its account, as before.

## 1. The import

_To be written with the import itself: mapping, import script, dry run, reconciliation gate,
invitation batches and rollback window — issue #130. Keep step 0 at the top of this file._
