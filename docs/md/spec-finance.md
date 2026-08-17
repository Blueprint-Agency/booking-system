# Finance: one surface for every Money Event

## Problem Statement

The studio owner cannot answer "what did we make last month" from the platform.

The money is all there, but scattered. A member's purchase lives in `stripe_payments` and `client_packages`. What a Promotion or Promo Code took off is derivable from List Price against the amount paid, but nothing shows it. A Refund flips a purchase's status and is otherwise invisible. What each instructor is owed is on the Payroll page, which is the only screen in the platform that adds anything up — and it adds up the one figure that is money going *out*.

So the owner opens four screens, the Stripe dashboard, and a spreadsheet, and does the subtraction by hand. The PRD promised a Revenue report and a Teaching log report; neither exists, and no reports surface is mounted at all.

Two smaller problems ride along with it. Instructor Pay is optional when a session is scheduled, so sessions sit Unpriced and any total computed over them understates what the studio owes. And nothing anywhere filters money by Location, so the owner cannot compare Breadtalk IHQ against Outram Park.

## Solution

One page, `/admin/finance`, listing every **Money Event** — money in and money out — for a filtered period, with the studio's five headline figures above it.

It replaces the admin Payroll page entirely. Pay editing and Manual Entries move onto Finance unchanged. `/instructor/payroll` survives as **Teaching log**: an instructor still sees their own sessions and their own pay, and still never sees a studio total.

A Money Event is one row. Purchases, Cross-Location Add-Ons, workshop tickets and corporate packages are money in; Refunds are money in with a negative sign; Instructor Pay and Manual Entries are money out. Each row sits on the date the thing happened — a purchase on its payment date, a session's pay on the session's date.

Above the table, an **overview** for the period: the five figures — **Gross**, discounts given, Refunds, Instructor Pay, and **Net** — plus members joined, sales by Sale Category, pay by instructor, and class popularity by attendance. Active Members sits with them but is read as of **today** rather than over the period — the schema keeps no history for it, and the tile says so. The trial funnel is read on **Customers** (its Trials filter), not here. See `be/docs/adr/0003-finance-reads-as-a-general-ledger.md`.

The **period** control sits with the overview and drives both halves of the page. Every other filter narrows the table alone and the overview ignores it — a headline figure that moved because of a control the reader has already scrolled past is a lie that reads as a fact.

The table is a general transaction ledger, not a payroll sheet: Date, Time, User, **Type**, **Variant**, Price, Location, Discount, Code, Money in, Money out. Type is what the transaction was in the studio's words (Credit, Unlimited, Trial, PT Package, Add-on, Workshop, Corporate, Merch, Class, PT Session, Manual, Refund); Variant is which one of it ("Bundle of 10"); User is the member who paid *or* the instructor being paid, since a ledger line has one counterparty. Instructor Pay is one Type among many rather than the shape of the whole table.

Ledger filters: Type, User (one search box over members and instructors both), Location, and "Needs pay only". One button exports exactly the filtered rows as CSV.

Instructor Pay becomes required when an **admin** schedules a session and when anyone is added to a roster, so Unpriced sessions become rare. They do not stop entirely: an instructor scheduling their own class or PT session must never see pay rates, so that path still creates the session Unpriced. Those, and the ones that predate the rule, are surfaced through a "Needs pay" filter and cleared by hand.

## User Stories

1. As a studio owner, I want one page showing every Money Event for a period, so that I do not open four screens and a spreadsheet to see how the month went.
2. As a studio owner, I want a Net figure for a period, so that I know what the month actually earned after discounts, Refunds and Instructor Pay.
3. As a studio owner, I want Gross shown beside Net, so that I can see how much of my catalogue price I am giving away.
4. As a studio owner, I want the total money given away in Promotions and Promo Codes for a period, so that I can judge whether a campaign was worth running.
5. As a studio owner, I want each purchase row to show List Price, money off and amount paid, so that I can see the discount on an individual sale without opening the member's profile.
6. As a studio owner, I want to see which Promo Code was used on a purchase, so that I can attribute a sale to the campaign that produced it.
7. As a studio owner, I want free grants and $0 trials to appear as a 100% discount rather than vanish, so that comped business shows up as a cost rather than as nothing.
8. As a studio owner, I want Refunds to appear as their own negative row on the date they were refunded, so that a closed month's figures never change retroactively.
9. As a studio owner, I want a refunded purchase to still show its original row, marked as refunded, so that the history of a buy-then-refund is legible rather than erased.
10. As a studio owner, I want Cross-Location Add-On money on its own row, so that I can tell how much the Add-On earns independently of the plan it hangs off.
11. As a studio owner, I want workshop ticket money in the same view, so that a workshop's revenue does not need a separate report.
12. As a studio owner, I want corporate package sales listed, so that off-platform-negotiated business is not missing from the month.
13. As a studio owner, I want the total Instructor Pay for a period, so that I know what to pay out at month-end.
14. As a studio owner, I want a per-instructor breakdown of pay for a period, so that I can pay each instructor the right amount.
15. As an admin, I want to set an instructor's pay for a session inline from Finance, so that I do not lose the workflow the Payroll page gave me.
16. As an admin, I want to add a Manual Entry for a bonus or correction, so that money owed outside any session is still counted.
17. As an admin, I want to delete a Manual Entry I added by mistake, so that a typo does not distort the month.
18. As an admin, I want purchase and Refund rows to carry no edit controls at all, so that I cannot accidentally alter what the payment provider recorded.
19. As a studio owner, I want to filter by Location, so that I can compare how the two studios are doing.
20. As a studio owner, I want money the platform cannot place at a Location grouped as Unattributed, so that the gap is visible rather than silently missing from both studios.
21. As a studio owner, I want to understand at a glance why a purchase is Unattributed, so that I do not read it as a bug.
22. As a studio owner, I want to find one person's rows — a member or an instructor — by typing their name, so that I can review what they cost or spent without hunting through pickers. *(One search box replaced the instructor and class-type pickers on screen; the route still accepts `instructor_id` and `class_type_id`, so a control is one component away if the search box proves too blunt. See `be/docs/adr/0003-finance-reads-as-a-general-ledger.md`.)*
23. As a studio owner, I want to narrow to one kind of transaction, so that I can see what a class costs to run or what a category sold, without a picker per dimension.
24. As a studio owner, I want a date range with presets and a custom option, so that "last month" is one click and an odd period is still possible.
25. As a studio owner, I want the page to open on the current month, so that the common case needs no input.
26. As a studio owner, I want the tiles to total the whole filtered range rather than the visible page, so that paging through rows never changes the headline figures.
27. As a studio owner, I want to export the filtered rows to CSV, so that my bookkeeper gets the month without access to the platform.
28. As a studio owner, I want the export to contain exactly what the filters selected, so that I never have to reconcile the file against the screen.
29. As a studio owner, I want Net to warn me when any session in the range is Unpriced, so that I do not trust a figure that is still incomplete.
30. As a studio owner, I want Unpriced sessions excluded from the pay total rather than counted as zero, so that the total never understates what I owe.
31. As an admin, I want a "Needs pay" filter, so that I can find and clear the Unpriced sessions that predate the new rule.
32. As an admin, I want to be required to enter pay when I schedule a class, PT session or workshop, so that a session I create never goes Unpriced.
32a. As an instructor, I want to schedule my own class without being asked for pay, so that I am never shown or asked to decide a rate — the session lands on the admin's "Needs pay" list instead.
33. As an admin, I want to be required to enter pay when I add a supporting instructor to a roster, so that the requirement cannot be sidestepped by editing the roster afterwards.
34. As an admin, I want an existing session's pay to survive a roster edit, so that a figure I entered is never silently lost.
35. As an instructor, I want to see my own sessions and my own pay, so that I can check my month against what I am paid.
36. As an instructor, I want never to see studio totals, other instructors, or any money coming in, so that the page shows me my work and nothing about the business.
37. As an instructor, I want my Manual Entries visible on my own log, so that a bonus I was told about is something I can confirm.
38. As a super-admin, I want the same Finance surface with the same edit rights as an admin, so that I can correct a figure without impersonating.
39. As an admin, I want rows ordered newest first, so that the most recent activity is what I see without scrolling.
40. As an admin, I want the table paginated, so that a wide date range does not make the page unusable.
41. As a studio owner, I want the Payroll nav entry to be gone rather than left as a stale duplicate, so that nobody reports figures from a retired screen.
42. As a developer, I want every figure on the page computed by one function, so that the tiles, the table and the CSV cannot disagree.

## Implementation Decisions

### The one new seam

A pure function — call it `summarizeFinance` — takes a flat list of Money Events and returns the sorted rows, the five tiles, the per-instructor pay breakdown and the Unpriced count. No DB, no HTTP. **Every arithmetic rule lives here**: money accumulated in cents so repeated addition does not drift, discount derived as List Price minus amount paid, Refunds carried negative, Unpriced excluded from totals and counted separately.

This mirrors `services/payroll/totals.ts` exactly, which already works this way and is already unit-tested. Finance is a `services/finance/` module beside it.

The query half — call it `getFinance(filter)` — unions the money-in sources with the existing payroll rows and does no arithmetic of its own. It is deliberately thin so that nothing worth testing lives in it.

### Money-in sources

| Money Event | Read from |
|---|---|
| Package purchase (class pack, PT pack, Unlimited Plan, trial) | `client_packages` — `list_price_sgd`, `amount_paid_sgd`, `purchased_at`, `applied_promo_code_id`, `location_id` |
| Cross-Location Add-On | `client_packages.cross_location_paid_sgd`, as its own row |
| Workshop ticket | the booking that paid for it, joined to `stripe_payments` |
| Corporate package | `stripe_payments` where kind is `corporate_package`, at status `succeeded` **or** `refunded` — the refund webhook flips the status, and filtering to succeeded would drop the sale out of Gross while its Refund row stayed. List Price equals amount paid |
| Merch Order | `merch_orders` — the order row, not the payment row, so a free item still counts. List Price equals amount paid |
| Refund | `stripe_payments.refunded_at` with the amount negated |

`promo_code_redemptions.discount_sgd` is **not** the source of the discount figure. List Price minus amount paid is, because it is correct for a stacked Promotion and Promo Code, for a comp grant with no payment intent, and for a $0 trial — all cases where a Redemption row is absent or tells only part of the story.

A purchase with no payment intent (an admin-issued grant) is a Money Event like any other: List Price is recorded, amount paid is zero, discount is the whole List Price.

### Money-out sources

Unchanged from payroll: main and supporting pay on classes and PT sessions, workshop instructor pay, and Manual Entries. The existing "completed" rule holds — lifecycle active and the session already ended — so a cancelled session owes nothing and a future one has not happened yet.

Corporate sessions remain absent from the cost side: neither corporate table carries a pay column, so there is nothing to list or price.

### Dates

Accrual. A purchase sits on its payment date, a Refund on its refund date, Instructor Pay on the session's date, a Manual Entry on its own date. A workshop spanning several days uses the first day's start, as payroll already does.

No cash-basis view and no payout-run record. See the ADR.

### Location

Joined for classes, PT sessions and workshops, all three of which carry a NOT NULL Location. (The off-site free-text venue is on *corporate sessions*, which have no pay column and never reach this surface.) Everything else — every non-Unlimited purchase, every Merch Order, every corporate sale, every Manual Entry — is **Unattributed**, which is a first-class filter value and not a null hole. Filtering to a Location excludes Unattributed rows; filtering to Unattributed shows only them.

### Editing

Row mutability is a property of the row type and is carried in the API response, not re-derived by the frontend. Purchases, Add-Ons, workshop tickets, corporate sales and Refunds are immutable. Instructor Pay rows and Manual Entries are editable exactly as they are on Payroll today, through the same service path — a pay edit is a roster write and continues to go through the roster module, so which storage shape holds the pay stays the roster's business.

The existing save-reason vocabulary is kept: a save that did not happen answers with its reason and its own status code, rather than a bare boolean.

### Required pay

Enforced in the service layer, not in each route, so both the scheduling paths and the roster-edit path are covered by one rule. Existing rows with no pay are left alone; the "Needs pay" filter is how they get cleared.

The DB column stays nullable. Making it NOT NULL would require inventing values for existing rows, which is the thing this decision explicitly refuses to do.

### API

One admin route surface replacing `/portal/admin/payroll`, taking date range, Type, user search and Location as optional filters, and returning rows, tiles, per-instructor pay totals and the Unpriced count. A sibling `/finance/overview` takes a date range and **nothing else**, and returns the period's headline block; its money half regroups the same rows rather than re-querying them, so a category breakdown cannot disagree with the Gross tile above it. Pay edit, Manual Entry create and Manual Entry delete move across unchanged in shape. Both admin and super-admin get full read and write.

CSV is the same endpoint's rows serialized, not a second query — the file and the screen come from one read.

The instructor route keeps its current shape: the same underlying read with the instructor forced to the caller, returning their rows and their own total and nothing else.

### Docs to update in the same change

`prd.md` §8 (Revenue and Teaching log collapse into one Finance report), §8.3 (strike the principle that super-admin report surfaces carry no edit affordances), §2 (drop "no payout report"); `admin-restructure.md` (nav and page); `be-portal.md` §Payroll (replaced by §Finance). `CONTEXT.md` and `be/docs/adr/0002-finance-replaces-payroll.md` are already written.

## Testing Decisions

A good test here asserts on figures a person would check on the screen, given a set of Money Events. It never asserts on how the rows were fetched, how many queries ran, or the internal shape of an intermediate value.

**Almost everything is tested at the one pure seam.** `summarizeFinance` takes a list and returns numbers, so every rule gets a test without a database:

- a discounted purchase reports discount as List Price minus amount paid;
- a comp grant at $0 reports its full List Price as discount, not as absent;
- a corporate sale reports no discount;
- a Refund subtracts from Net and lands on its refund date, while the original purchase row stays in the set;
- an Unpriced session is excluded from the pay total and raises the Unpriced count by one;
- repeated addition of amounts like 0.10 and 0.20 totals exactly, because accumulation is in cents;
- Gross, discounts, Refunds, Instructor Pay and Net satisfy the stated relationship for a mixed set;
- rows come back newest first;
- an Unattributed row is excluded when filtering to a Location and included when filtering to Unattributed.

Prior art is `services/payroll/totals.test.ts`, which is this exact style — construct rows, call the pure function, assert the totals — and `services/payroll/save-reasons.test.ts` for the save-failure vocabulary, which carries over unchanged.

The required-pay rule is tested at the service that enforces it: scheduling without pay is refused, adding a supporting instructor without pay is refused, and an existing pay figure survives a roster edit. That last one is a regression the roster work already identified.

Not tested: the query layer, which has no arithmetic; the CSV serializer, which is a projection of already-tested rows.

## Out of Scope

- **What the payment provider keeps.** Fees are not recorded and are not being captured. Net is before them.
- **Per-Location revenue attribution by consumption.** A package's revenue is never spread across the Locations where its credits were burned.
- **Payout runs / cash basis.** The platform does not record when an instructor was actually paid.
- ~~**Merch.**~~ Now in scope and implemented: a Merch Order is paid online and only collected in person, so it is money in. Read from `merch_orders` so free items (no payment row) still count. No Promo Code, no Location, discount always zero.
- **Partial refunds.** A Refund is the whole amount, as it is everywhere else in the platform.
- **Backfilling existing Unpriced sessions.**
- ~~**The other four PRD reports** — attendance, membership, inbox throughput, referral attribution.~~ Partly in scope now: the Finance overview reports class attendance and Active Members. Inbox throughput and referral attribution remain unbuilt.
- ~~**Charts and trends.** Five tiles and a table. No sparklines, no period-over-period comparison.~~ Class popularity carries a period-over-period delta against the equally-long window immediately before. Still no sparklines and no stored aggregate: a delta answers "is this class growing or dying" without a bucketing decision.
- **Corporate session pay.** No pay columns exist on the corporate tables.

## Further Notes

The two mutabilities in one table are the main risk. If a purchase row ever grows an edit control, the platform starts disagreeing with Stripe and there is no way to tell which is right. The row-type-carries-mutability decision exists specifically to make that hard to get wrong.

Super-admin editing Finance contradicts a stated PRD principle. That is a deliberate reversal, recorded here and struck from the PRD rather than quietly ignored.

The Unpriced warning on Net should become unreachable once pay is required. Keeping it is cheap and it is the only way a bypass would announce itself.
