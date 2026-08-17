# Backend

The domain. Every rule in the platform lives here — booking, credits, scheduling, payments, and instructor leave. The two frontends render what this context decides; they never decide anything themselves.

## Language

### Packages and locations

**Location**:
One of the studio's two physical premises — Breadtalk IHQ or Outram Park. A class runs at exactly one Location.
_Avoid_: branch, studio, venue, outlet, site

**Unlimited Plan**:
A purchased plan that pays for any class at its Home Location, as often as the member likes, until it expires. Distinct from a Credit Bundle, which pays per class.
_Avoid_: membership, subscription, unlimited package

**Credit Bundle**:
A purchased balance of credits, each booking deducting the class's cost. Location-agnostic — credits work at either Location.
_Avoid_: pack, class pack, points

**Home Location**:
The one Location an Unlimited Plan covers, chosen by the member at purchase. Only an Unlimited Plan has one; no other kind of plan carries a Location.
_Avoid_: home branch, primary location, base studio

**Cross-Location Add-On**:
A paid extension to one Unlimited Plan that makes it Cover the other Location as well as its Home Location. Priced per month of the plan it extends, rounded up to a whole month. It belongs to that one plan, not to the member: it expires with the plan, waits Dormant with the plan, and a member holding two plans buys one per plan.
_Avoid_: cross-branch top-up, second branch unlock, upgrade, dual-location pass

**Covers**:
The relation between a plan and a Location — the plan permits a free booking there. An Unlimited Plan covers its Home Location; it also covers the other Location while it carries a Cross-Location Add-On.
_Avoid_: includes, allows, valid at

**Duration**:
How long an Unlimited Plan runs, counted in whole calendar months. A 6-month plan Activated on 15 January ends on 15 July, not 180 days later. Where a month has no matching day the end date falls on the last day of that month — 31 August plus 6 months ends 28 February.
_Avoid_: length, term, validity, duration days

**Dormant**:
An Unlimited Plan bought while the member already holds a live one. It is paid for, but its clock has not started — it waits behind the plan in front. A plan bought when the member holds no live plan is **not** Dormant; its clock starts at purchase. Only an Unlimited Plan can ever be Dormant. Contrast **Activated** — clock running, end date fixed.
_Avoid_: pending, inactive, unused, scheduled, queued

**Activation**:
The moment a Dormant Plan starts its clock: the first confirmed class booking that plan pays for, which can only happen once the plan in front has expired. The end date is fixed at that moment, one Duration forward from that day. A member who stops attending keeps the plan waiting and loses none of it. Activation happens once and never reverses on its own; only staff can return a plan to Dormant.
_Avoid_: start, redemption, kick-off, going live

### Merch

**Merch**:
A physical item the studio sells — a mat, a prop, apparel. It has a Title, a Description, a Price and a photo, and nothing else: no stock count, no Location, no expiry. It is not a product a member is *entitled* to anything by, which is why it grants no credits and books no session.
_Avoid_: product, SKU, inventory, stock item, store item, merchandise line

**Merch Order**:
One member's purchase of one Merch item, paid for online and **collected in person**. The order row is the receipt the front desk hands the item over against — there is no shipping, no fulfilment state and nothing to mark done. It keeps its own copy of the Title and the amount paid, so renaming, repricing or deleting the item never rewrites what the member bought.
_Avoid_: cart, basket, shipment, delivery, fulfilment, sale

### Discounts

**List Price**:
What a product cost on the day it was bought, before any Promotion or Promo Code. Recorded on the purchase itself and never rewritten, so a later change to the catalogue cannot restate what a member was charged last year. List Price minus Promotion minus Promo Code is the amount paid.
_Avoid_: original price, full price, RRP, catalogue price, price

**Promotion**:
A price cut the studio publishes on one product. It applies itself at purchase while its window is open, and the member types nothing. Contrast a **Promo Code**, which the member must type.
_Avoid_: promo, sale, offer, deal, discount

**Promo Code**:
A price cut the member must type at checkout to receive. One code reaches across products, and it may be capped in total and is always capped at one use per member. Contrast a **Promotion**, which applies itself.
_Avoid_: promo, coupon, voucher, discount code

**Redemption**:
One member's single use of one Promo Code. It is Held when their checkout begins and Consumed when their payment succeeds. A member never holds two on the same code.
_Avoid_: use, usage, claim, application

**Hold**:
The claim a Redemption places on a Promo Code while a checkout is in progress. It occupies one of the code's places, and it lapses by itself when the checkout is abandoned. Nothing releases it by hand.
_Avoid_: reservation, lock, pending, soft-booked

### Refunds

**Refund**:
Money returned to a member for one purchase, always the whole amount — there is no such thing as a partial one. It never describes a credit going back to a wallet: a cancelled booking returns a credit or a session, and calling that a refund confuses money with entitlement.
_Avoid_: partial refund, refund a credit, reimbursement, chargeback, revoke

**Void**:
What a Refund does to the purchase it paid for — the entitlement ends at that moment and every booking on it that has not yet happened is cancelled. Contrast **Expired**, the clock running out, and **Dormant**, the clock not yet started. Only a Refund voids; nothing else does.
_Avoid_: cancel, revoke, deactivate, reverse, nullify

**Untouched**:
The property that makes a purchase refundable without a warning: no class it paid for has been attended or no-showed. A booked class that has not yet been held leaves a purchase Untouched, because refunding simply cancels it. A no-show does not — the class ran and the seat was held. A purchase that is no longer Untouched can still be refunded, but only by an admin who has been told and chosen to anyway.
_Avoid_: unused, unconsumed, clean, fresh, pristine

### Money

**Money Event**:
One thing that moved money, or that owes money, on the day it happened. A purchase, a Refund, a session's Instructor Pay, or a Manual Entry. Every figure the studio reports is a sum over Money Events; there is no separate stored total.
_Avoid_: transaction, ledger entry, line item, record

**Type**:
What a Money Event was, in the studio's own words — Credit, Unlimited, Trial, PT Package, Add-on, Workshop, Corporate, Merch, Class, PT Session, Manual, Refund. A different axis from the event's `kind`, which says which table the row came from and whether an admin may edit it: two kinds can share a Type (a Workshop ticket sold and the instructor paid to teach it), and one kind splits across several (a purchase is a Credit, an Unlimited, a Trial or a PT Package). Carried on the event, because only the query that read the row knows it.
_Avoid_: category, product type, kind

**Counterparty**:
The one person a Money Event is with — the member who paid, or the instructor being paid. One per event, never both: which side of the studio they stand on is what Type says, so the two never need their own columns. Called `party` on the event, `user_name` on the wire, and shown as **User**.
_Avoid_: client, customer, payee, recipient, both parties

**Variant**:
Which one of the Type — "Bundle of 10", the workshop's name, the merch item's title, the class's name. Null where the Type is the whole story: a Refund, a Corporate package, a Cross-Location Add-On.
_Avoid_: description, label, item, product name, SKU

**Sale Category**:
What the studio sells, grouped as an owner groups it: Classes, Personal training, Workshops, Corporate, Merch. Coarser than Type on purpose — Credit, Unlimited, Trial and the Add-On are four products and one question. Only money-in events have one.
_Avoid_: revenue stream, segment, product line, bucket

**Active Member**:
A member holding a live entitlement — an active, unexpired package — **today**. A stock, not a flow: unlike every other overview figure, a longer period does not make it bigger, and it does not move with the period at all. A Dormant Unlimited Plan counts; its clock has not started, but the member holds it. Not datable to a past instant: `client_packages.active` carries no history, so "Active Members at the end of June" is a figure this schema cannot produce — see ADR 0003.
_Avoid_: subscriber, current member, paying member, retained member

**Instructor Pay**:
What one instructor is owed for one session they taught, main or supporting. It belongs to the session's date, not to the date the studio hands over the money — the platform does not know when that happens.
_Avoid_: salary, wage, payroll, fee, rate

**Manual Entry**:
An amount owed to an instructor that no session accounts for — a bonus, a correction, a one-off. It carries its own date and its own words, and it totals exactly like Instructor Pay.
_Avoid_: adjustment, bonus, ad-hoc pay, override

**Unpriced**:
A session whose Instructor Pay has not been decided. It is not pay of zero, so it is excluded from every total and counted separately — a total that quietly treated it as free would understate what the studio owes.
_Avoid_: unset, empty, zero, null, missing pay

**Unattributed**:
A Money Event the platform cannot place at a Location, because nothing about it records one. Every class pack, PT pack and trial is bought without a Location; only an Unlimited Plan carries its Home Location. Naming the gap keeps it visible instead of silently dropping the money from a Location's figures.
_Avoid_: unknown, other, global, studio-wide, n/a

**Gross**:
The sum of List Price across every purchase in a period, before any Promotion or Promo Code. What the studio would have taken at catalogue prices.
_Avoid_: revenue, sales, turnover, top line

**Net**:
Gross, less the money taken off by Promotions and Promo Codes, less Refunds, less Instructor Pay. It is not profit — it excludes rent, wages other than instructors', and what the payment provider keeps.
_Avoid_: profit, margin, bottom line, earnings, take-home

**Class Popularity**:
How many people turned up to each Class Type over a period — check-ins, never bookings, because a booked no-show is not popularity. Carries one comparison: the same count over the equally-long window immediately before, which is absent (not zero) when the period has no start.
_Avoid_: attendance rate, demand, bookings, utilisation, trend line

### The trial funnel

Three questions about the same person, read on Customers rather than on Finance: it is a question about a client, not about a period.

**Trial Funnel**:
Of the members who bought a Trial Pass: how many attended, and how many went on to pay. Lives behind the Customers page's Trials filter and is counted from the rows that filter shows.
_Avoid_: trial report, conversion funnel, trial pipeline, leads

**Trial Attendance**:
Classes a member attended **on their trial** — bookings paid for by the trial package itself. Attendance on any later package is somebody else's number: a member who skipped their trial and came back months later on a bundle turned up zero times, and zero is the follow-up signal.
_Avoid_: attendance, visits, check-ins, sessions used

**Converted**:
A member who has paid for a package that is not another trial — ever, not "after the trial". A second trial is not a conversion, a comped grant is not a conversion (nothing was paid), and someone who bought a bundle before trying a new class is already converted.
_Avoid_: upgraded, retained, activated, signed up, won

### Instructor leave

**Leave Request**:
An instructor's application to be absent for one or more dates, of one Leave Type.
_Avoid_: leave, absence, time off, holiday

**Leave Type**:
Annual, medical or study. The three are entirely separate — days never move between them, and each has its own Assigned Days on the instructor's profile.
_Avoid_: leave category, leave kind, study leave allowance

**Leave Year**:
The calendar year a Leave Request counts against, fixed at submission from its first date. Recorded on the request so that changing a number later cannot rewrite a past year.
_Avoid_: leave period, entitlement year

**Assigned Days**:
The yearly figure set on an instructor's own profile, one per Leave Type — 14 annual, 14 medical, 7 study by default, changeable per instructor. It is the input to next year's Pool, not the Pool itself.
_Avoid_: allowance, entitlement, quota, allocation

**Carried Days**:
Unused annual days moved into the following Leave Year, capped by a studio-wide limit. Only annual leave carries; medical and study days are use-it-or-lose-it.
_Avoid_: rollover, accrual, carry-forward, banked days

**Pool**:
Assigned Days plus Carried Days, for one instructor, one Leave Type, one Leave Year. The number leave is drawn from, fixed for the year once the year begins. An admin can move it, but nothing else does.
_Avoid_: allowance, entitlement, grant, balance, budget

**Committed**:
Days on Leave Requests that are pending or approved. Both count — a pending request has already drawn down the Pool. There is deliberately no separate held or reserved state.
_Avoid_: held, reserved, on hold, provisional, soft-booked

**Taken**:
Days on approved Leave Requests only. What an instructor has actually used, as distinct from Committed.
_Avoid_: used, consumed

**Remaining**:
Pool minus Committed — what an instructor can still apply for. It can go negative when a Pool is lowered below what is already Committed, and it is shown negative rather than hidden.
_Avoid_: balance, available, left, unused

**Half Day**:
Morning or afternoon, costing 0.5 days, permitted only on a Leave Request covering a single date. The boundary is 13:00 Singapore time.
_Avoid_: partial day, AM/PM leave

**Supporting Document**:
One optional file an instructor attaches to a medical or study Leave Request — never to an annual one, which has nothing to evidence. JPG, PNG or PDF up to 5MB, handed back to admins and to its own instructor through a short-lived signed link (the bucket itself is public, so the two-UUID key is the real protection — see backend-architecture.md §6c). One request holds one; a second upload replaces the first.
_Avoid_: medical certificate, MC, attachment, proof

**Occupying**:
The property that makes an instructor unschedulable on a date. Pending and approved Leave Requests both occupy; everything else does not. Leave occupies a person, never a room.
_Avoid_: blocking, unavailable, busy

**Leave Conflict**:
Two instructors an admin has declared cannot be away at the same time. Unordered — naming them either way round is the same declaration, and the database enforces that rather than trusting a caller to normalise. It counts every Leave Type, because the point of the pair is cover and the studio has lost that instructor whatever the reason. It grants nothing and takes nothing away, and it is never retroactive: declaring a pair refuses their next overlapping request and leaves approved leave exactly where it is.
_Avoid_: cover group, pairing, no-overlap rule, blackout

**Leave Cap**:
The greatest number of instructors who may be on **study** leave at the same moment. The studio sets it. It is measured as a peak across instants, not a headcount over dates, so leave that never coincides never reaches it. It counts study leave only, across every instructor — counting all leave would make study leave nearly unobtainable. Medical leave counts toward it and is never refused by it. Who may not be away *with whom* is not a headcount and is not this: that is a Leave Conflict.
_Avoid_: limit, quota, threshold, max concurrent leave

**Cover Group** — _removed 2026-08-17_:
Was one flat, studio-wide ticked set of instructors who covered each other. **Replaced by Leave Conflict**, which names specific pairs instead of one anonymous set. Do not use the term for new work; it survives here only so that a reader who meets it in an old commit or issue can find out what became of it. The survey behind the decision, including the option that was recommended and not taken, is `docs/md/research-cover-group-ux.md`.

**Cover Group Leave Cap** — _removed 2026-08-17_:
Was the greatest number of Cover Group members who could be away at once, counting every Leave Type. **Removed with the Cover Group and not replaced**: a Leave Conflict is a pair, so "at most 2 of these 6 away at once" is deliberately no longer sayable. Leave Cap now means the Study Leave cap alone.

### The four ways a Leave Request ends

Each belongs to exactly one actor and one starting status. They are not interchangeable.

**Withdraw**:
The instructor abandons their own request while it is still pending.
_Avoid_: cancel, delete, retract

**Cancel**:
The instructor gives back their own approved leave, before it starts.
_Avoid_: withdraw, revoke

**Reject**:
An admin refuses a pending request. A reason is mandatory and is emailed to the instructor.
_Avoid_: decline, deny, revoke

**Revoke**:
An admin takes back leave they already approved, before it starts. Once leave has started it is permanent — there is no path that un-approves lived days.
_Avoid_: unapprove, cancel, reject, reverse
