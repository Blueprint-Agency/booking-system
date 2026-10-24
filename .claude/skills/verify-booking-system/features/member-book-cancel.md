# Member books and cancels

A member holding a class package books a class from the schedule, sees it under My bookings with its QR code, and cancels it. Inside the free window the credit comes back; inside the late-cancel window the booking is cancelled but the credit stays spent.

## Sub-features

- `book-from-schedule` books a class with credits from the home schedule.
- `my-bookings` lists upcoming bookings (classes, workshops, PT, corporate) with QR and Cancel where allowed.
- `cancel-in-window` cancels and returns the credit.
- `cancel-late` cancels inside the late window and keeps the credit spent, with a warning first.
- `credits-balance` shows the package's remaining credits under My packages.

## How to get to it (user POV)

- Home schedule › a day › **Book Now** › **Book class**.
- **Account** › **Up next** (QR, Cancel).
- **Account** › **My bookings** (`/account/bookings`, `?type=class`; `/account/classes` redirects there) › **Cancel** › **Confirm cancellation**.
- **Account** › **My packages** (`/account/packages`) for the balance.

## Driving it with verify-booking-system

Preconditions:

- Doctor passes. `members.canceller` holds `packageCredits` credits and has nothing booked; `members.lateCanceller` holds `packageCredits − 1` and is booked into `catalogue.lateCancelClassType`; `members.holder` is booked into `catalogue.myBookingsClassType`, the workshop, a PT session and a corporate request.

- **Balance before.** `signInMember(page, members.canceller)`, `goto(urls.client + '/account/packages')`. The card holding `catalogue.packageName` reads `<packageCredits> credits`.
- **Book.** `goto(urls.client)`, expand the day holding `catalogue.cancelClassType`, click its `Book Now`, then `Book class` in the dialog `Book <class>?` (the package radio is checked). `You're booked!` appears; `Done`; the row shows `Booked`. The balance is now one less.
- **Cancel in window.** `goto(urls.client + '/account/classes')`, click `Cancel` on the booking, then `Confirm cancellation`. The text `Booking cancelled · 1 credit returned.` appears; the balance is back to `packageCredits`.
- **Late cancel.** As `members.lateCanceller`, `Cancel` on `catalogue.lateCancelClassType`. The dialog `Cancel this booking?` says `This is a late cancellation — your credit won't be returned.`; after `Confirm cancellation` the text reads `Booking cancelled · a late cancellation, so the credit wasn't returned.` and the balance is unchanged.
- **My bookings.** As `members.holder`, `/account` region `Up next` shows the class with `Show my QR` and `Cancel`. `/account/bookings` lists the class, the workshop and `1-on-1 · Any class type`, each with `Show QR code`; the workshop says `To change or cancel, contact the studio.` and has no cancel button.
- **Proof.** `sql` on `bookings` (`state`, `cancelled_at`, `refund_outcome`), `credit_movements` (`cause`, `delta`, `balance_after` per step) and `email_log` (booking and cancellation templates), all filtered by `tenant_id` and the member's `client_id`.

## Gotchas

- These recipes come from the CI journeys `e2e/journeys/cancel-and-refund.spec.ts` and `my-bookings.spec.ts` (same studio, same locators) and have not yet been run through this skill. The first agent to run them should save the drive in `../drives/` and update the README's status.
- A day's classes are collapsed: expand the day's `h2 > button` until `aria-expanded="true"` before looking for `Book Now` (see `e2e/src/schedule.ts` `openDayOf`).
- `Book Now` exists twice in the DOM (mobile and desktop); use `.locator('visible=true')`.
- `canceller` and `lateCanceller` are spent by one run of each journey. Run `down` and `up` for a fresh studio.
