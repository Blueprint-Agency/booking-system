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

## 1. Before the day: the decisions

Twenty decisions belong to the studio, not to the operator, and every one of them is a field in
the studio config. `transform` refuses to run while any is open, so the day cannot start until
they are settled. Walk this table with the studio's admin in a sitting of its own, well before
the freeze — decisions 11 and 12 are fixed **in Mindbody**, so they have to be done before the
*final* download, not after it.

| # | Decision | What the studio provides | Default if they have no view |
|---|---|---|---|
| 1 | Studio identity | Slug, display name, timezone, owner's admin email, and anyone else who runs the portal from day one (`studio.admins`) | — (required) |
| 2 | Locations | Name, address, phone for each | — (required) |
| 3 | Rooms | Which Mindbody room spellings are one Room; capacity of each; which "rooms" are really off-site venues | Off-site venues dropped from Rooms |
| 4 | Class capacity | Seats per class, per Room, with exceptions per class name | Room capacity |
| 5 | Class Types | Which class names are the same Class Type (case, spacing and spelling variants) | Trimmed, case-folded name |
| 6 | Catalogue | For every pricing option: `sell`, `legacy` or `skip`; and for `sell`, the list price, sessions and length | `legacy`, with the inferred sessions and length |
| 7 | Credit cost | Credits per class | 1 |
| 8 | Cancellation policy | Late-cancel window (hours) for classes and PT; cancellations allowed per cycle and cycle length. Note: on the platform a member cannot cancel inside the window at all | 24 h, 24 h, 3 per 30 days |
| 9 | PT requests | How many days ahead a PT request stays open | 7 |
| 10 | Staff | Email and role (Admin or Instructor) for each person migrated; who is the owner; which of two records sharing a name is which | Instructor; former teachers archived |
| 11 | Members with no email | Real email, fixed in Mindbody before the final download | Placeholder email, fixed later by an admin |
| 12 | Members sharing an email | Which member keeps it; real emails for the others | The one whose last visit (attendance history) is latest keeps it; others get placeholders |
| 13 | Two live packages at once | Accept "the one ending soonest runs, the others wait with their days left" | Accepted |
| 14 | Unlimited Home Location | Location for a member no report places | Retention Management's location, then Membership's, then where their visits were sold, then the plan's name, then the main Location — the preflight counts each |
| 15 | Future workshops and retreats | Which to migrate; tier (room type) prices; how instalments count | All with paid attendees; price = amount paid |
| 16 | Teacher pay | Use the pay-rate report's per-class amount for future classes; PT pay | Per-class rate; PT Unpriced |
| 17 | History | How far back; whether past purchases appear in Finance | None on a quick rehearsal; classes and bookings from opening, purchases off |
| 18 | Not migrated | How to track live mat storage, lone access passes and corporate balances by hand | Listed in the preflight report |
| 19 | Class Series | Which weekly classes repeat, and the term end date to extend to | Proposed from the last 4 weeks |
| 20 | Cutover timing | Freeze start, launch date, the date Mindbody may be cancelled | — (required) |

The studio's own answers — its slug, its Locations, its owner's email — live in the studio's
private folder outside the repository (`studio/answers.json` and the configs filled from it; see section 2).
None of them belongs in this repository.

Two more things to have in hand before the day:

- **A rehearsal that passed.** Run the whole of this file on staging at least once, with the
  history cutoff the launch will use, and keep the timings. See section 7.
- **The preflight sent and answered.** The rehearsal's `<studio>.preflight.md` is the list the
  studio works through in Mindbody: members with no email, members sharing one, and everything
  still live that does not come across. It is much shorter on launch day if they fix it once,
  early.

## 2. The download (cutover profile)

The migration tooling lives in `be/tools/mindbody/`, apart from the app (nothing in `be/src`
imports it, and it is not in the server image):

```
be/tools/mindbody/
  report-files.json   the report files the transform reads = the files the cutover download writes
  download/           the downloader: drives the studio's Mindbody sign-in in Chrome (Playwright)
  transform/          reports + studio config -> the super portal's import archive; fill, verify
```

The code is here; the **data is not**. Every report, config, answer and archive names real
people, so it lives in a private folder outside the repository, one folder per download:

```
<MB_EXPORT_ROOT>/
  .mindbody-login.env, auth.json     the studio's Mindbody sign-in and saved session (private)
  studio/                            the studio's own inputs: answers.json (for fill), the starter
                                     config (holds the invitation secret), decisions and notes
  <YYYY-MM-DD HHmm>/                 one download, named for when it started
    reports/Clients/<NN Report>/…    the Excel files, one folder per report
    reports/Staff/<NN Report>/…
    _logs/as-of.txt                  when the last report landed: the config's asOf
    config.<output>.json             filled configs, and the facts they were filled from
    <name>.zip + .ids.json + .preflight.md + .expected.json    each archive built from it
```

Set `MB_EXPORT_ROOT` in `be/.env` (see `be/.env.example`); the sign-in file and the saved session
default to `<root>/.mindbody-login.env` and `<root>/auth.json` (`MB_LOGIN_FILE`, `MB_AUTH_FILE`).
The downloader opens a visible Chrome window — Mindbody's studio search refuses a headless one —
so only someone with the studio's login runs it. On the day:

```bash
cd be
npm run mindbody:download -- --profile cutover --dry-run   # the plan: every file, view and date range; no browser
npm run mindbody:download -- --profile cutover             # the download, into a fresh <root>/<YYYY-MM-DD HHmm>/
npm run mindbody:download -- --login-only [--fresh]        # just check (or, --fresh, redo) the sign-in
```

The folder it writes is what `transform --export` is pointed at, as it is; its
`_logs/as-of.txt` is the config's `asOf`, written on the studio's clock (`MB_TIMEZONE` in
`be/.env`, or `--timezone`; a download refuses to start without it), whatever timezone the
operator's machine is set to. The downloader takes every cutover file name and its
single rule from `be/tools/mindbody/report-files.json` — the transform's own list, pinned by a unit
test against the matchers and the single/required rules (`REPORT_RULES` in `transform.ts`) — and
`download/plan.test.ts` checks that the names it works out from each report's number, view and page
type are exactly that list, so neither side can drift from the other. After a real run every file
written is checked against its expected name as well. The history cutoff the download starts
from (`MB_START`, default 2023-01-01) must be on or before the config's `history.from`. Every
date range is computed from the run date:

| Report (view) | Range |
|---|---|
| Mailing Lists (Mailing List), Retention Management, Phone Book, Pay Rates, Account Balances (All balances), Visits Remaining (Detail) | as of the download |
| Referral Types (each referrer group), Big Spenders (Detail Accrual), Promotions (Detail) | history cutoff → today |
| Pricing Option Expirations | history cutoff → today + 5 years |
| Attendance without Revenue (**Date view only**), one file per year | history cutoff → today |
| Payroll (Detail), one file per year | history cutoff → today |
| Schedule at a Glance ("Scheduled", all locations, staff and statuses), one file per year | history cutoff → today + 12 months |
| Staff Schedule (ALL, "Scheduled") | history cutoff → today + 5 years |
| Membership (New Version Detail) | optional, as of the download |
| Autopay Detail ("Scheduled"; Reports → Payment Processing — Mindbody has no "AutoPay Schedule" report) | optional, today → today + 12 months: every autopay still to run is a preflight line, to stop in Mindbody; none is imported |

Birthdays, addresses, emergency contacts, client notes and waiver status are in **no** Mindbody
report: they come, if at all, from a client data export requested from Mindbody, by hand. The
transform does not read them.

What the profile is built to:

- **Only the reports the transform reads.** They are listed at the end of section 3, and nothing
  else: the full 42-report run takes far longer, and the freeze is paid for in minutes.
- **Schedule and roster ranges run from today into the future.** Staff Schedule (ALL,
  "Scheduled") and Schedule at a Glance must reach the last date the studio has anything
  scheduled — not "up to today", which is what an ordinary download does, and which would lose
  every future class and every seat already booked on one. A studio bringing its past also needs
  **Attendance without Revenue** (View by: Date) and **Payroll** (Detail) back to the history
  cutoff from decision 17. Only the Date view of Attendance without Revenue is read: its Client,
  Staff member and Visit type views are the same visits sorted differently.
- **A capped or refused report is a hard failure.** Mindbody truncates a report that is too large
  and says so quietly. A report the transform reads as one file fails the run if it comes back
  capped or refused, rather than being split; the per-year reports are split by year from the
  start. Any required report that fails ends the run with `CUTOVER DOWNLOAD INCOMPLETE` and a
  non-zero exit: do not transform that folder. A silently truncated file transforms into a
  studio that has simply lost those members, and nothing downstream can tell the difference.
- **The finish time is recorded.** The moment the last report landed is the **"as of"** moment:
  it is what `--as-of` is given, it is the day every live balance is true for, and it is the
  moment the freeze has to cover from.

**The freeze window** runs from the start of this download until verify passes. Through it the
studio takes no bookings, no sales and no schedule changes in Mindbody. Anything typed into
Mindbody after the "as of" moment is not in the archive, and an admin re-enters it on the
platform by hand.

## 3. The transform (reports → studio archive)

The transform (`be/tools/mindbody/transform/`) turns an export folder of downloaded Mindbody
reports plus a **studio config** into a zip the super portal's import reads. It needs no database
and no backend environment. The reports, the config and everything it writes name real people:
keep them in the private export folder, never in this repository. `--export` takes the export
folder's full path, or just its name (`"2026-01-31 0100"`) to find it under `MB_EXPORT_ROOT`.

```bash
cd be
# 1. A config pre-filled from the reports. Fill in every null — by hand, or step 1b.
#    --as-of defaults to the export's _logs/as-of.txt (when the download finished); with it the
#    catalogue proposal is only what is still held.
npm run mindbody -- starter --export <export folder> --out <root>/studio/starter-config.json
# 1b. Or fill it by rule from the studio's private answers (names, emails, Rooms, what is on sale):
#     writes <export folder>/config.<output>.json for each `outputs` entry, plus the facts it used.
npm run mindbody -- fill --export <export folder> --starter <root>/studio/starter-config.json --answers <root>/studio/answers.json
# 2. Provision the Tenant in the super portal WITHOUT a first admin; copy its id.
# 3. The archive, for that Tenant: <export folder>/<slug>.zip (or --name <name>, or --out <file.zip>).
#    Only for a database on this machine: a config with localhost origins needs --local.
npm run mindbody -- transform --export <export folder> --config <config.json> --tenant <tenant id>
# 4. Import the zip in the super portal, export the studio from the same page, then:
npm run mindbody -- verify --expected <studio.expected.json> --export-zip <exported.zip>
```

- `fill` holds the rules (`transform/fill.ts`: who comes across as Instructor or Admin, which
  options are on sale and at the commonest price of the last 90 days, Room capacities from the
  largest class each held, which service categories are workshops). Every value it fills in is
  the studio's, from `answers.json` (`StudioAnswers` in `fill.ts` documents each field). Rerun it
  on each new download; it never edits the starter.
- `transform` refuses to run while a field is open, and lists every one by name.
- It also checks every row it wrote against the database's CHECK rules
  (`be/tools/mindbody/transform/constraints.ts`, kept complete by an integration test that reads the live
  constraint list) and writes no zip while any row breaks one — an import is all or nothing,
  and a refused row would otherwise fail it only at the end. If the database still refuses an
  import, the super portal names the table and the rule, not the SQL.
- Build the zip for the Tenant it will be imported into (`--tenant` = that Tenant's id). Into
  any other it still imports, under new ids, but `verify` then compares different ids and
  reports every row.
- Beside the zip it writes `<studio>.ids.json` (Mindbody key → platform id, per table),
  `<studio>.preflight.md` (members with no email, and emails several members share: who keeps
  the address, who gets a placeholder on `no-email.invalid`; what is still live in Mindbody and
  does not come across; money on account) and `<studio>.expected.json` (what the studio should
  add up to). Send the preflight to the studio.
- `verify` counts the exported studio the way `transform` counted its own archive — members,
  staff by role, live packages by kind, credits and sessions left in total and per member,
  classes, PT sessions and workshops, bookings in total, per member, per class and per
  workshop, and — for a studio that brought its past — classes held, visits attended and
  no-shows per calendar year. It lists every difference by member, by class, by workshop or by
  year, and exits non-zero on any. Run it straight after the import, before anybody books.
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
  where Mindbody files two rooms under one spelling (a studio that relabelled its rooms), each
  Room but one lists the `rooms[].classTypes` it holds under that spelling and the last takes the
  rest; a class's Room decides its Location, so a Room at the wrong Location moves its classes —
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
- **Class Series** are proposed by `starter` from the timetable's recurring pattern: what ran at
  the same weekday, time, Room and name in each of the four weeks up to `asOf`, taught by the
  latest week's own teacher (not a substitute). A slot that stopped is not proposed. A person
  sets `migrate` on each; a confirmed one is written as a series whose imported classes are
  linked to it and whose last date is the last class that came across — or, where none is still
  to come (the published timetable runs only days past the download), its last class before
  the download — so launch day starts with an extend and nothing is duplicated. Its teacher must
  be coming across as an active instructor, or the portal could never extend it.
- A Class Type with no future class and no Class Series arrives archived; history still names it.
- A future booking the running package cannot cover (it ends first) is paid by the member's
  package waiting behind it, where that will still be running then. The rest are preflight
  lines, split into "unpaid in Mindbody too" and "unmatched" (Mindbody holds something that
  would pay for it).
- **The studio's past** is optional and off by default: `history` in the config is `null` for a
  quick rehearsal, and `{ "from": "2019-01-01", "purchases": false }` for a launch that wants it.
  `from` is the first day to bring, on the studio's own calendar. Past classes are the union of
  what the schedule report holds for those days — empty ones included — and any session only the
  roster reached, because the schedule download may start later than the cutoff. Each carries the
  pay the **payroll Detail** report says the teacher was actually given, matched on date, time and
  teacher, and is Unpriced where payroll has no line for it. A past class with no Room behind it
  (Mindbody left the room blank) and no capacity of its own is sized like its Location's largest
  Room rather than dropped. Past bookings come from the **Attendance without Revenue** report
  (Date view), one per visit, whose `Staff Paid` / `Late Cancel` / `No-show` flags say how it
  ended: *signed in* (paid, neither flag) is `confirmed`/`attended` with a
  `check_ins` row (manual, by the owner), *absent* or *no-show* is `no_show`/`forfeited`, a
  *late cancel* is `cancelled`/`forfeited` with a `cancellations` row, a seat the studio never
  marked comes across `confirmed` with its check-in still pending, and an **early cancellation is
  not imported** — it is a booking nobody kept and nobody was charged for. The visit's pricing
  option names the package that paid for it, and only where that package came across. Past PT is
  the future-PT shape with the request `attended` or `cancelled_after_scheduled`.
- An imported late cancel inside the **current cancellation cycle** is written with source
  `admin`, not `client`. The platform counts a member's own cancellations over a rolling cycle to
  cap them, and history landing inside that cycle would spend an allowance the member never spent
  here — so every member starts on the platform with a clean one.
- **Past purchases** are a second, separate opt-in (`history.purchases`), because they are
  pre-launch money and they show in Finance on the day they were sold. They are Big Spenders'
  sale lines from the cutoff on — keyed by **client id**, so a purchase always lands on the
  member whose id is on the sale, and two members of one name are never swapped. Each line is
  joined to the pricing-option register row it created (a member it could be by name and phone,
  the same option, the latest sale on or before the row's activation, its own price first), which
  lends it its expiry; a line the register never lists (a day pass, a promo bundle) runs its
  validity from the sale date. A line whose register row is still live at the download — something
  left *and* not expired — already came across as a package. Every other line is an inactive
  `client_packages` row dated on its **sale date**, at its sale Location where the platform holds
  one (an Unlimited Plan's Home Location). **List Price is what was paid**, plus what a promotion
  took off it (Promotions, Detail, joined by sale number) — so only a real promotion shows a
  discount — and a $0 package is **Complimentary** unless it is a Trial the catalogue sells for
  money. **Anything that cannot be placed** — an item in no catalogue entry, a workshop place, a
  client not in the member list — is counted in the preflight with its money, never guessed.
  A past *trial* for a member who already came across holding one cannot come across — a member
  may hold only one trial ever — so the money it took is a preflight line instead.
- A **return** (quantity −1) is a Refund on the past purchase it reverses (the same member and
  option, sold no later than the return, the same amount first). It is written as a
  provider-less Purchase closed as refunded on the day of the return (`purchases.refunded_at`),
  which Finance lists as a Refund; the package is tagged Refunded. A migrated package still has
  no payment row. A return with nothing to reverse is a preflight line. The register row of a
  returned sale is never a live holding. `verify` compares revenue by month and every Refund.
- The cutover download checks Big Spenders' client cap against the Member count, and refuses
  the download where the cap could have left somebody out.
- A past visit points at the package that paid for it only where the attendance report's pricing
  option is one the member's own history or live holdings actually hold, and where that holding's
  run covered the day. Anything else and the seat names no package: a wrong package would read
  worse than none.
- History is never a refusal. A class name nobody teaches any more, a room that closed, a teacher
  left out of the config: each is a preflight line and its classes stay behind, so a studio can
  still launch. A teacher who appears only in history should be migrated `archived`, which is
  what `starter` proposes for an inactive one.
- **How long a full history takes.** Measured on a synthetic eight-year studio — 11,693 past
  classes, 93,455 bookings, 70,084 check-ins: under ten seconds to map, a few more to write the
  zip (12 MB), and between half a minute and a minute and a half to import. Allow a couple of
  minutes and do not assume the import has hung. The import writes each table in batches rather
  than a round trip per row, which is what keeps that last figure in seconds.
- Whatever could not be matched — a booking with no class, a member not in the member list, a
  class over its capacity, a series with nothing to continue — is a line in the preflight, and
  the import goes ahead without it.
- The Tenant must be provisioned with the config's `studio.slug`: the import refuses an archive
  built for another slug, because its email links name that slug.
- Staff invitations are good for 7 days from the **import**, not the download: the importer
  counts a pending invitation in a Mindbody archive from when it arrives. After that, resend
  them from the portal's staff page, which extends the link.
- The import keeps the Tenant's branding. The archive says nothing of a logo, theme, copy or
  mail-from, and whatever the super portal gave the Tenant stays; the display name and reply-to
  the config gives are written.
- The email links are built from the config's `originPatterns`. A config whose patterns name
  `localhost` (or `127.x`) is refused unless `transform` is given `--local`, so a zip built
  with the local config cannot reach staging or production with links to the operator's machine.
- `fill` proposes `policy.classWindowHours` from the Cancellations report: the smallest whole
  hour that parts the members' own early cancels from their late ones. `fill` prints it, with how
  many cancels were on the wrong side of it; with no early or no late self-cancel, the config's
  own value stands. `studio.mailReplyTo` and `studio.emailFooter` come from `answers.json`.
- Same reports + same config + same Tenant id → the same zip, byte for byte. Row ids are
  UUID v5 of the Tenant id and the Mindbody key; invitation tokens are keyed by the config's
  `secret`, which `starter` writes once at random.
- Reads today: Mailing Lists (Mailing List), Referral Types (detail files: creation date),
  Retention Management (gender), Phone Book (staff), Visits Remaining (Detail `.xlsx`: holdings),
  Pricing Option Expirations (the catalogue proposal, and each purchase's dates) and Big Spenders
  (Detail Accrual: the catalogue proposal, past purchases and returns), Promotions (Detail,
  optional: a sale's discount), Staff Schedule (ALL, "Scheduled": the
  timetable), Schedule at a Glance (`.xlsx`, one per year: who is booked into what) and, if they
  were downloaded, Account Balances (All balances), Pay Rates (`.xlsx`), Attendance without
  Revenue (Date view, `.xlsx`; one file or one per year) and Payroll (Detail, one per year). The
  last two are only read by a studio importing history; without them its past arrives with no
  visits and every past class Unpriced. Cancellations (Individual records, one file per month)
  is optional too: with it a past late cancel carries the time it really happened and who made
  it (the member or ClassPass → `client`, anyone else → `admin`); without it the cancel is dated
  at the class's start.
- Payroll pays past PT as well as classes: a past PT session's Instructor Pay is what payroll
  paid for that appointment. Payroll lines with nothing to belong to — a `TBD` revenue share
  on a retreat, a class that did not come across — are listed in the preflight with the total
  placed and not placed, so every dollar is accounted for.
- A holding Visits Remaining shows combined (two packs of one option) is split back into its
  purchases from the pricing-option register where the register accounts for it exactly —
  each with its own expiry, credits and price. A holding that is one purchase takes that
  purchase's price rather than the report's combined total.
- Balances are Mindbody's Unbooked. Credits Mindbody set aside for future bookings that do not
  come across (the roster was not downloaded far enough ahead) are given back to the member's
  package and named in the preflight, rather than lost.
- Phones are stored E.164 (`+65…`), as the member sign-up writes them, formatted with the
  member's Country in the Mailing List (`defaultCountry` where it is blank). Mindbody's dummy
  phone is empty; a number that cannot be formatted is imported empty and listed in the
  preflight. Proposed Validity counts both the activation and the expiry day. The transform can be pointed at the whole download
  folder: every other report and view in it is left alone.
- `starter` names the Locations what the timetable calls them (oldest first, matched to the
  numbers Retention Management prints) and proposes each Room at the Location it holds most
  classes in; the PT appointment names come from the roster and the attendance report both.
- Writes: settings, Locations, Rooms, Class Types, policy, PT booking config, all email
  templates, every member profile, the class and PT catalogue, every live package, staff — the
  owner (`studio.ownerEmail`) and everyone in `studio.admins` (an owner or an agency Mindbody
  never listed as staff gets a staff row of their own) an active Admin with no invitation;
  with `staffOnboarding: "active"` every migrated staff member with an email is active too, with
  no invitation, and sets a first password through Forgot password (or an admin's set-password
  link) — importing sends nothing; a staff member marked `noLogin` (no email of their own) is
  active by name under a `no-email.invalid` placeholder, so they teach and are paid but nobody
  can sign in as them, and the portal never offers to mail that address;
  other migrated staff pending with an invitation to resend from the portal, `archived` teachers
  with a placeholder email — the timetable still to come: Class Series, classes, PT requests
  and sessions, workshops with their days, tiers and instructors, and every booking on them —
  and, where the config asks for history, the studio's past: the classes it held with the pay
  payroll gave them, the bookings on them with their check-ins and late cancellations, its past
  PT, and (on the second opt-in) the packages members bought and used up before launch.

Every import — this one and a restored export alike — creates or reuses the sign-in account of
every member and staff row by email, with no password, inside the import's transaction; a failed
import leaves no accounts behind. No archive carries logins, so no row keeps the account id it
came with (#229). The archive's manifest carries `ensureAccounts: true`, which lets its rows name
no account and refuses any studio but the one it was built for. An archive without the flag
(every export) still needs each row to name an account, as before.

## 4. Launch day, in order

Every step in one sitting, in this order. Do not start until section 1 is settled, the
rehearsal passed and the preflight has been answered.

1. **Freeze Mindbody.** The studio stops taking bookings, sales and schedule changes. Tell them
   in the room, not by email: from here on, anything typed into Mindbody is re-typed later.
2. **Download**, with the cutover profile (section 2). Write down the finish time; that is
   `--as-of` from here on. If any report came back capped or refused, stop — fix the range and
   download again. Do not transform a short file.
3. **Config.** Fill the rehearsal's starter config again from the new download — the facts
   (class names, what is on sale and at what, who taught lately) and `asOf` come from the new
   export, the answers from `studio/answers.json`:

   ```bash
   cd be
   npm run mindbody -- fill --export <new export folder> --starter <root>/studio/starter-config.json \
     --answers <root>/studio/answers.json
   ```

   If the studio has new staff, series or pricing options since the rehearsal, make a fresh
   starter from the new download instead (`starter --export <new export folder> --out …`) and
   fill that. `starter` refuses to write over an existing config — it holds the `secret` the
   invitation tokens are keyed by. Either way, check the filled catalogue against the new
   Pricing Option Expirations report: an option the studio started selling since the rehearsal
   is a new decision 6, and a new line in `answers.json`.
4. **Back up production.** Section 0, in full. Write the snapshot id in the launch ticket. This
   is the only way back, and a rehearsal does not excuse it.
5. **Provision an empty Tenant**, in the super portal → **New studio**, with the config's
   `studio.slug` and display name and **no first admin**. It opens suspended, which is right: a
   studio nobody can sign in to should not answer as though it were open. Copy its id.

   Provisioning *with* an admin email seeds templates and a staff row, and the import would
   refuse the Tenant as not empty.
6. **Transform**, for that Tenant id:

   ```bash
   npm run mindbody -- transform --export <new export folder> \
     --config <new export folder>/config.<output>.json --tenant <tenant id>
   ```

   It refuses while any config field is open and names every one. Read the counts it prints and
   the new `<studio>.preflight.md` before going on: a preflight that grew since the rehearsal
   means something changed in Mindbody that nobody mentioned.
7. **Import.** Super portal → the Tenant → **Import**, and upload `<export folder>/<slug>.zip`. It is
   all-or-nothing: a failure leaves the Tenant empty and you import again. The owner's staff row
   arrives active, and the Tenant opens at that moment. Allow a couple of minutes for a studio
   with history, and do not assume it has hung.
8. **Verify**, before anybody books. Super portal → the Tenant → **Export**, then:

   ```bash
   npm run mindbody -- verify --expected <studio.expected.json> --export-zip <exported.zip>
   ```

   It exits non-zero on any difference and lists each one by member, class, workshop or year.
   **A non-zero verify stops the launch**: go to section 6, do not fix rows by hand.
9. **The owner gets in.** The owner is an active Admin with no password yet, so they set one
   from the portal's **Forgot password** at `{slug}.portal.reservetoday.app` using the config's
   `studio.ownerEmail`. Have them do it with you, and confirm they can see the schedule and the
   member list.
10. **The owner invites staff.** Portal → Staff. Everyone else arrived pending with an
    invitation; the owner sends or resends each one. Invitations expire 7 days after the import,
    and resending extends the link, so a late one is not a blocker.
11. **Extend the imported Class Series.** Portal → Schedule → open any class of a series → the
    Series panel → **Extend**, to the term end date from decision 19. The imported timetable
    stops at the last class Mindbody had; this is what carries it forward. Preview shows every
    date and its clashes before anything is created, and extend never duplicates a date that
    already has a class.
12. **Open to members.** The Tenant has been active since step 7 and its address works, so this
    last step is the announcement, not a switch: the studio tells members the new address, and
    each member types their email and is sent a link to set a password. The platform sends
    nothing to members on its own. Only now is the freeze over, and the studio starts taking
    bookings on the platform instead of Mindbody.

Keep Mindbody readable — not writable — until the date in decision 20, so a question about a
member's history has somewhere to go.

## 5. What "done" looks like

- `verify` exited zero.
- The owner has signed into the portal.
- Every migrated staff member has an invitation sent (or resent) and not revoked.
- Every series in the config has classes to the term end date.
- The preflight's open lines have an owner: members on a placeholder email, live mat storage,
  lone access passes and corporate balances are all tracked by hand by the studio, not by the
  platform.

## 6. Rollback

Rollback is a restore, not a repair. Never edit imported rows to make verify pass: the archive
is deterministic, so a rerun of the same reports and the same config gives the same studio, and
a hand-edited one gives something nobody can reproduce.

1. Tell the studio the freeze holds. Mindbody stays frozen; it is still the system of record.
2. Restore the snapshot from step 4, with the command in section 0. It restores beside live,
   snapshots live again, then swaps the two in one transaction, so the failed attempt is kept
   until it is dropped.
3. Fix the cause — nearly always the config, or a report that came back short.
4. Provision a **fresh empty Tenant** and import into that. Re-importing into a Tenant that
   already has rows is refused, and rightly.
5. Verify again. The freeze lifts only when it passes.

If the restore itself misbehaves, every refusal it can give is documented in the infrastructure
repo, [`docs/backup-restore.md`](https://github.com/Blueprint-Agency/infrastructure/blob/main/docs/backup-restore.md),
"Restore to live".

## 7. Rehearsing on staging

The rehearsal is the same file, start to finish, against staging: `booking-staging` in step 4,
the staging super portal in steps 5, 7 and 8, `{slug}.portal.reservetoday.app` on staging in
step 9. Two differences and nothing else:

- The downloads are real, and so is the history cutoff the launch will use. A rehearsal on a
  `history: null` config proves the timetable and the packages, not the import's size; run at
  least one with the real cutoff, which doubles as the production-sized dataset.
- Mindbody is not frozen, so the figures move under you. That is fine: verify compares the
  archive with what was imported, not with Mindbody.

Record, on the rehearsal's ticket: how long the download took, how long the transform took, how
long the import took, what verify said, and every gap found — a config field nobody could
answer, a report that came back capped, a preflight line the studio had not seen. Those timings
are what the freeze window is budgeted from.
