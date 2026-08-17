# One Finance surface replaces the admin Payroll page

**Status**: accepted (2026-08-17) — supersedes the split between the Revenue report and the Teaching log report in `docs/md/prd.md` §8, and retires the admin Payroll page described in `docs/md/be-portal.md` §Payroll.

The platform records money in five places and reports it in none. `stripe_payments` holds what was charged, `client_packages` holds List Price against amount paid, `promo_code_redemptions` holds what each Promo Code took off, the refund webhook flips a purchase to refunded, and the payroll surface totals what instructors are owed. An owner asking "what did August make" has to open four screens and a Stripe dashboard, and the only screen that adds anything up — Payroll — adds up the one figure that is money going out.

The PRD answered this with two separate reports: a Revenue report and a Teaching log. We are instead building **one** `/admin/finance` surface that lists every Money Event, in and out, and nets them. The admin Payroll page is absorbed into it. `/instructor/payroll` survives, renamed Teaching log, because an instructor must see their own rows and never a studio total.

## Why one surface rather than two

The number the owner actually wants is Net, and Net cannot be computed on either page alone. Two pages means the subtraction happens in someone's head or in a spreadsheet, which is where the reporting already lives today. Merging them also means one filter set, one date convention and one CSV export instead of two of each.

The cost is that a single table now holds rows of two different mutabilities: purchases and Refunds are provider facts and carry no edit affordance at all, while Instructor Pay and Manual Entries are edited inline as they are today. That distinction has to be visible in the UI, and it is the main thing that could go wrong with this decision.

## Accrual, not cash

Every Money Event sits on the date it happened — a purchase on its payment date, Instructor Pay on the session's date. This is not what the studio's bank statement will show, because instructors are paid in a batch at some later point that the platform does not record.

The alternative is cash basis, which requires a payout run: a stored record of which pay rows were settled and when. That is a real feature with its own screen, its own irreversibility and its own reconciliation story. Accrual answers "what did August earn and cost" using only dates already stored, and it is the question being asked.

## Location is recorded on the cost side only

Every class, PT session and workshop names a Location. Almost no purchase does — `client_packages.location_id` is the Home Location of an Unlimited Plan and is null for every class pack, PT pack, trial and corporate package. A Location filter therefore attributes Instructor Pay precisely and most revenue not at all.

The tempting fix is to attribute a package's revenue to the Locations where its credits were later consumed. We are not doing that: it makes August's revenue change in October, so no period is ever final, and a closed month that keeps moving is worse than a month with an honest gap in it. Instead the gap is named — **Unattributed** — and appears as a bucket in its own right.

## Instructor Pay becomes required

Pay is optional today at scheduling time and on a roster edit, which is why Unpriced sessions exist at all. Because Net is now a headline figure, an Unpriced session makes the studio look more profitable than it is. Pay becomes required when a session is scheduled and when anyone is added to a roster.

This puts whoever knows the pay rates in the scheduling path, which is a real operational cost and was weighed against leaving pay optional with a "Needs pay" filter to clear the backlog at month-end. Required won because a warning that must be actioned later is a warning that gets ignored.

**It cannot be required of everyone, and the exceptions matter more than the rule.** Instructors schedule their own classes and PT sessions, and instructors must never see pay rates — so that path still creates the session Unpriced and an admin prices it afterwards. Corporate sessions are exempt outright: neither corporate table has a pay column, so every entry on one is unpriced by construction and none of it is money the studio owes.

That splits the enforcement in two, deliberately:

- **Joining an existing roster** — supporting instructors, a swapped main — is a domain invariant and lives in the roster module's single write path, so both audiences and every future scheduling surface inherit it.
- **The main instructor at creation** is written onto the session row at insert, so they are never an "arrival" that rule can see. Who must supply a figure there depends on *who is asking*, which makes it an audience rule rather than a domain one — so it sits on the admin routes, and the instructor routes are silent about it by design.

The consequence to keep in view: new Unpriced sessions are rarer, not impossible. The Unpriced warning on Net therefore stays load-bearing rather than becoming decorative.

## Consequences

- The arithmetic lives in one pure function over Money Events, mirroring the existing payroll totals module, so the tiles and the CSV cannot disagree with the table.
- The payroll module is **not** renamed. It stays the owner of what "a completed session that owes pay" means, and Finance consumes it as its cost-side source. Renaming it would have been churn across the instructor's Teaching log for no behavioural gain.
- The required-pay rule is enforced in the roster merge's one write path rather than in each scheduling route, so a future scheduling surface inherits it instead of forgetting it.
- Existing Unpriced sessions are **not** backfilled. Setting them to zero would invent numbers; they are surfaced through a filter and cleared by hand.
- The Unpriced warning on Net stays, and is genuinely reachable: an instructor scheduling their own session creates it Unpriced by design. It is also how a bypass — a migration, a seed, a bug — would announce itself.
- Super-admin gets edit rights on Finance, contradicting the PRD's principle that super-admin report surfaces carry no edit affordances. That principle is struck rather than worked around.
- Merch **is** included. It was out of scope when this decision was drafted — merch was browse-only — but a Merch Order is now paid for online and only *collected* in person, so it is money in like any other. It carries no Promo Code and no Location, so its discount is always zero and it reports as Unattributed.
- What the payment provider keeps is absent. Capturing it means a new webhook field and a backfill, for a figure the provider's own dashboard already reports.
- Corporate packages appear with List Price equal to the amount paid. They have no `client_packages` row and no discount data, and their price is negotiated off-platform, so any discount shown for them would be fiction.
