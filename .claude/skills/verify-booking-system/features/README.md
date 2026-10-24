# Booking system verification map

The maintained source for verifying what users of the booking system can do. Read this index before driving, then follow the matching feature file as the recipe. Launch, doctor, drive, evidence and cleanup are in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- `node .claude/skills/verify-booking-system/scripts/stack.mjs up` printed `[verify] READY`, and `stack.mjs doctor` exits 0 with every line `ok`.
- One studio, `e2e-<random>`, made by `e2e:studio setup`; its values are in `<run>/studio.json` and reach a drive as `studio`. Slugs, emails, class ids and passwords are new every run: never copy one into a file.
- What the studio starts with (`be/src/e2e/studio.ts`): an admin and an instructor sharing `studio.staff.password`; one class package (`catalogue.packageName`, `packageCredits` credits, `packagePriceSgd`); seven scheduled classes (`studio.classes.*`) plus `catalogue.portalClassType` with nothing scheduled; a free workshop; a PT package; a corporate package; one merch item; a Location `E2E Studio` with a room `E2E Room`; ten members, each set up for one journey (`buyer` holds no plan; `canceller`, `lateCanceller`, `arriver`, `waiter`, `holder` hold the plan).
- Tenancy checks also need `stack.mjs studio` (writes `studio-2.json`, read with `loadStudio(2)`).
- Never drive a stack this run did not start, and never two drives at once.

## Driving conventions

- One drive per feature journey, run with `node .claude/skills/verify-booking-system/scripts/drive.mjs <drive.mjs>`. Proven drives live in `../drives/`; write new ones in your scratch directory.
- Each journey uses its own member from `studio.members` so drives don't depend on each other's order. A drive that spends a member's credits or books their class changes the studio for the rest of the run; run `down` and `up` for a clean studio.
- Locate by role, label and visible text, as `e2e/journeys/*.spec.ts` do. Copy a locator from there before writing a new one.
- Members start signed in (`signInMember`); staff and the super operator sign in through the real form (`signInStaff`, `signInSuper`).

## Proof and skip reporting

- Capture the user action and the resulting state: `shot` and `aria` before and after.
- Confirm every mutation from a second view (reload, another page, another role) **and** from its rows via `sql`, filtered by `tenant_id`.
- Emails are proven from `email_log`; payments from `purchases`, `stripe_payments` and `receipts` (stub payments carry no card details).
- Report the drive's evidence folder and its `RESULT` line. An entry point you did not drive is reported as not verified, with the reason, never as verified through another path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph describing what the user sees, then exactly four H2s in order: `Sub-features` (short IDs, one line each), `How to get to it (user POV)` (every entry point), `Driving it with verify-booking-system` (`Preconditions:`, then labelled bullets pairing each user action with the exact call and its observable result), and `Gotchas`.

## Features

| Feature | Covers | Recipe status |
|---|---|---|
| [Member checkout and Receipt](./member-checkout-receipt.md) | Buy a package with the stub card, confirmation, Receipt page, Receipts list, book on the new credits | Proven: `drives/member-buy-receipt-book.mjs` passed 2026-10-24 |
| [Tenant isolation](./tenant-isolation.md) | A member's session, a header and a class id from one studio reaching another | Proven: `drives/tenant-isolation.mjs` passed 2026-10-24 |
| [Member books and cancels](./member-book-cancel.md) | Book with credits, cancel inside the window (credit back), late cancel (credit kept), My bookings | Locators from the CI journeys `cancel-and-refund.spec.ts`, `my-bookings.spec.ts`; not yet run through this skill |
| [Admin schedules a class](./admin-schedule-class.md) | Admin creates a class in the portal; the instructor sees it on My schedule | Locators from the CI journey `schedule-a-class.spec.ts`; not yet run through this skill |
| [Super portal studios](./super-portal-studios.md) | Operator signs in, creates a studio, edits its Business details | Sign-in and the New studio form were checked live 2026-10-24; create and Business details not yet run through this skill |
