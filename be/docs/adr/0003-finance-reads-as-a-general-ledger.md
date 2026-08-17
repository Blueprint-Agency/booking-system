# Finance reads as a general ledger, with an overview above it

**Status**: accepted (2026-08-17) — extends `0002-finance-replaces-payroll.md`, which stands. This changes how the surface reads and what it reports, not what a Money Event is.

ADR 0002 merged the Payroll page into Finance and got the arithmetic right, but the screen kept Payroll's shape. Its filters were Instructor and Class. Its one descriptive column was a `label` that glued a product to a person — `"Bundle of 10 — Tan Wei Ming"` — so the only column naming what a row *was* was also the column naming *who*. An owner looking for "what did we sell in August" was reading a payroll sheet with sales rows in it.

## Type and Variant replace the label

A Money Event now carries a **Type** and a **Variant** instead of a `label`, and the person moves to its own field.

Type is a different axis from `kind`, and both are kept. `kind` is plumbing: which of the ten source queries produced the row, and — through `isEditable` — whether an admin may restate it. Type is the studio's vocabulary. They do not map one-to-one in either direction: a `purchase` splits into Credit, Unlimited, Trial and PT Package, while a Workshop ticket sold and the instructor paid to teach it share the Type Workshop across two different kinds. Collapsing them into one field would have meant either losing the editability rule or showing plumbing in a column an owner reads.

Type is set by the query that read the row and never inferred downstream. The alternative — deriving it in the serializer from the row's other fields — was rejected for the same reason `payKind` is carried rather than inferred: every such inference is a guess that breaks on the first row that doesn't fit the pattern.

The cost: the CSV's columns changed, so any saved spreadsheet formula against the old header breaks. Accepted rather than versioned — the export is read by one bookkeeper, and a `finance_v2.csv` would be a permanent tax for a one-off.

## One User column and one search box

Member and instructor collapse into a single `user_name`. A ledger has one counterparty per line, and which side of the studio they stand on is exactly what Type already says. The Instructor picker is replaced by one free-text box over both — needing to know whether a name is a member or an instructor *before* you can search for it was the instructor-shaped assumption this change exists to remove.

What this loses: the Class filter is gone from the screen. Type narrows to Class, but not to *which* class. The route still accepts `class_type_id` and `instructor_id`, so the capability is one UI control away if anyone misses it; nobody has yet, and two pickers that answer the same question three-quarters of the time is worse than one search box.

Search is applied in memory over the unioned events, like the Location filter before it and for the same reason — see the `ponytail:` note on `getFinance`.

## The overview sits above the filters, and is not filtered

Figures move to the top of the page, and the period control moves up with them. The period drives both halves; every other filter narrows the table alone and the overview ignores them.

This is the whole reason for the layout. A headline figure that changed because of a control the reader has already scrolled past is a lie that reads as a fact, and "total sales" narrowed to one instructor is not a total of anything. Putting the narrowing controls *downstream* of the figures they cannot change makes that structural rather than a rule someone has to remember.

The overview reports, over the period: the five money figures from 0002, members joined, sales by **Sale Category**, pay by instructor, and class popularity by attendance. Active Members sits with them but is not period-scoped — see below. The trial funnel is **not** here: it is a question about a client, not about a period, and it ships on Customers as that page's Trials filter.

**The money half is not re-queried.** It is `getFinance` over the same period, regrouped in memory. A category breakdown computed from its own `SUM` would eventually disagree with the Gross tile inches above it, and the disagreement would be found by an owner rather than by a test. There is a test asserting the breakdown sums to Gross.

## Deliberate limits

- **Trend is one number, not a series.** Class popularity compares the period against the equally-long window immediately before it. A real time series means a chart, a bucketing decision and a stored aggregate; a delta answers "is this class growing or dying", which is the question. All-time has no previous window and reports none rather than comparing a month against the studio's whole history.
- **Popularity is check-ins, not bookings.** A booked no-show is not popularity. This makes the figure depend on staff actually checking people in, which is a real operational dependency and the honest one.
- **Active Members is a stock, and it is measured today rather than at the period's end.** It is the only overview figure a longer period does not inflate — and the only one that does not move with the period at all. That is stated on the tile, because a reader scanning a row of period figures will otherwise read it as one.

  Dating it backwards is not something this schema can do. `client_packages.active` is a live boolean with no history: expiry, a refund and the balance reaching zero all flip it down, and only the first two leave a date behind. An "as of the end of the period" query built on that column reads today's flag against a historical expiry bound, so it silently **undercounts** every closed period — a bundle live through June but used up in July is `active = false` now and drops out of June. The undercount deepens the further back you look, which is the worst possible shape for a figure compared month to month. A true stock-at-a-date needs a `deactivated_at` column set at all three flip sites, or a credit ledger to replay the balance from; both are schema changes, and neither is worth one tile before launch. Reported as "today" until one exists.
- **Conversion is "paid for something that isn't a trial", ever** — not "bought after this trial". A second trial is not a conversion, a comped grant is not one either (nothing was paid), and a member who bought a pack before trying a new class is already converted. Trial attendance is scoped to the trial package itself, not the member's attendance overall: someone who skipped their trial and came back later on a bundle attended their trial zero times, which is the follow-up signal the whole funnel exists for. All three are correlated subqueries rather than joins, because each counts over all time and a join would multiply the trial rows by their own matches. This is a **Customers** concern, not a Finance one; it is recorded here because this ADR is where the overview's scope was drawn.
- **No caching.** The overview is four extra queries on a page an admin opens a few times a day. Measure before adding one.
