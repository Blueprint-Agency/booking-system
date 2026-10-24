# Member checkout and Receipt

A member with no plan buys the studio's class package by card, sees what was added, opens the Receipt the purchase issued, finds it again under Account › Receipts, and books a class with the new credits.

## Sub-features

- `checkout-package` buys a class package from Packages through Stripe Checkout.
- `checkout-declined` keeps the member on the checkout page with their details when the card is declined.
- `checkout-confirmation` shows "You're all set!", the credits added and a link to the Receipt.
- `receipt-page` shows one Receipt: number, total, lines, payment history, Download PDF.
- `receipts-list` lists every Receipt the member has, with date filters and paging.
- `book-on-new-credits` books a class with the package just bought.

## How to get to it (user POV)

- Member app › **Packages** › the package's **Purchase** button › **Pay S$…**.
- The confirmation page's **View receipt R-…** link.
- Member app › **Account** › **Receipts**, then a Receipt in the list.
- The schedule (home) › a day › the class's **Book Now**.

## Driving it with verify-booking-system

Preconditions:

- Doctor passes. `studio.members.buyer` holds no plan and has not bought yet in this run.
- `catalogue.buyClassType` is scheduled (`studio.classes.buy`).

- **Whole journey.** Run `node .claude/skills/verify-booking-system/scripts/drive.mjs .claude/skills/verify-booking-system/drives/member-buy-receipt-book.mjs`. `RESULT pass`; evidence holds screenshots `01-packages` … `10-booked` and `sql-*` files.
- **Purchase.** `signInMember(page, members.buyer)`, `goto(urls.client + '/packages')`, then click `getByRole('button', { name: 'Purchase' })` inside the card holding `catalogue.packageName`. The checkout shows `getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ })`.
- **Pay.** Click Pay; the page goes to `checkout.stripe.com` (the stub). Fill `Card number` `4242 4242 4242 4242`, `Expiration date (MM / YY)` `12 / 34`, `CVC` `123`, `Cardholder name`, then click `getByRole('button', { name: 'Pay', exact: true })`. The text `You're all set!` and `<packageCredits> class credits added` appear.
- **Declined card.** As above with `4000 0000 0000 0002`. The stub page stays, with `getByRole('alert')` reading `Your card was declined.` and the typed fields kept. No new `purchases` row is `paid`.
- **Receipt.** Click `getByRole('link', { name: /^View receipt R-\d{6}$/ })`. The URL is `/account/receipts/<uuid>`, the heading is `Receipt R-…`, and inside `getByTitle('Receipt R-…').contentFrame()` the package name and `S$<price>` show.
- **Receipts list.** `goto(urls.client + '/account/receipts')`. The Receipt number is listed.
- **Book.** On the home schedule, expand the day holding `catalogue.buyClassType` (the `section` whose `h2 > button[aria-controls^="day-"]` has `aria-expanded`), click its `Book Now`, check the dialog `Book <class>?` has the package radio checked, click `Book class`. The dialog `You're booked!` appears; after `Done` the row shows `Booked`.
- **Proof.** `sql` on `purchases` (`status = paid`, `total_sgd` = the price), `stripe_payments` (`succeeded`), `receipts` (`display_number` = the Receipt shown, `kind = class_package`), `client_packages` (`credits_or_sessions_remaining` = credits − 1 after booking), `bookings` (`state = confirmed`), and `email_log` (`package_purchase_confirmed`, `class_booking_confirmed`).

## Gotchas

- The studio's setup already issued `R-000001` (the holder's free workshop place), so the buyer's first Receipt is `R-000002`. Match the number the page shows, not a constant.
- The Receipt body is an `iframe` with a sandboxed `srcdoc`. Assert inside `contentFrame()`. The "Blocked script execution in 'about:srcdoc'" lines in `console.log` are expected.
- The stub returns no payment method, so `stripe_payments.method` and `card_last4` are empty. Card brand or last-4 on a Receipt cannot be verified on this stack.
- Webhooks are never delivered. The confirmation page's session sync grants the package; a webhook-only path is not verified here.
- The buyer can buy only once per run for a clean check. A second run against the same studio sees two Receipts.
