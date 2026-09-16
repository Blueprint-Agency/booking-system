# Backend

The domain. Every rule in the platform lives here — booking, credits, scheduling, payments, and instructor leave. The two frontends render what this context decides; they never decide anything themselves.

## Language

> Throughout the entries below, **"the studio"** means *the Tenant the request is about* — never
> the platform, and never one particular business. Every figure, catalogue, roster and total is
> a figure for one Tenant; there is no platform-wide view of any of them, because the application
> role cannot read across Tenants at all. No real studio is named here, or anywhere in the repo.

### Tenancy

**Tenant**:
One studio business on the platform, and one row in `tenants`. Creating a Tenant is that insert — never infrastructure — and its subdomains resolve the moment the row exists. Tenant #1 (id `10000000-…-0001`) is a *position*, not a business: migration 0027 backfilled every row that predated tenancy to it, so on any given deployment it is whichever studio that database already held. Which one that is appears nowhere in the code.
_Avoid_: account, org, workspace, customer, client (a Client is a member — see below)

**Slug**:
A Tenant's leftmost DNS label, and the only thing the frontends can read a Tenant from — the API's own hostname never carries one. Validated as a hostname label and checked against the reserved list (`admin`, `api`, `portal`, `www`, `dev`, `staging`, `app`, `mail`, `clerk`, `assets`) at creation, because a Tenant that took the slug `admin` would take over the super portal's hostname. See `services/tenants/slug.ts`.
_Avoid_: subdomain, handle, tenant name

**`tenant_id`**:
The column on all 53 domain tables recording which Tenant a row belongs to — including pure join tables, because Row-Level Security needs a column on every table to key a policy on. `NOT NULL`, with **no default**: an insert that does not name its Tenant fails loudly rather than filing somebody else's row under the first Tenant. Every non-unique index leads with it. (The tenant-#1 default that made the migrate batches safe was scaffolding, and migration 0032 dropped it along with the seed pass that used to claim unclaimed rows.) The one nullable `tenant_id` outside those is `auth_events`, whose null rows are **Platform rows**.

**Tenant context**:
The Tenant a request is about — held in two places at once, and they are set together.

In the *application*, it is resolved once by `middleware/tenant.ts` and read in a route with `tenantId(c)`. It arrives as the `X-Tenant-Slug` header — the API's own hostname carries no Tenant, so the caller has to say — or, when the header is absent, as the tenant label in the browser's `Origin`. A request naming neither is refused `tenant_required`. Services never read it themselves: it is passed in, so a query that forgot to scope is a compile error rather than a leak.

In the *database*, it is `app.tenant_id`, written **transaction-locally** by `withTenant` (`db/index.ts`) and read back by every policy. Transaction-locally because session scope would ride a pooled connection into the next request. The same middleware opens it, so there is no state in which policies are live and no value is set. A caller with no request — a cron job, a test reaching past HTTP — has to open one for itself; `db/index.ts` and `jobs/index.ts` are the two places that do.
_Avoid_: current tenant, tenant scope, request tenant

**Tenant claim**:
What `X-Tenant-Slug` is: a statement by the caller, never a fact. The proxies set it, and a proxy is one forged header away from being impersonated, so every request is resolved from it and then **corroborated** by a second, independent statement — the browser's `Origin`, which under the subdomain scheme contains the Tenant, and on authenticated routes the **Session claim**, on a row the caller cannot edit. Disagreement is a 403; corroboration that names no Tenant (a server-side call sends no `Origin` at all) refuses nothing, because absence is not evidence. See `docs/md/spec-tenant-resolution.md`.
_Avoid_: trusted header, tenant header

**Session claim**:
The Tenant a Better Auth session was signed in on, written onto the session row (`claimed_tenant_id`) at sign-in from the Tenant the hostname resolved to. Unlike a **Tenant claim** it is a fact, not a statement: the row is ours and the token naming it is signed. `services/tenants/session-claim.ts` decides, and both studio middlewares ask (`staffAuth`, `clientAuth`): a session whose claim is not the resolved Tenant, or that carries none, is refused 403. So a session from studio A is worthless at studio B, and a staff member of two studios holds one user and one session per studio. `platform` sessions carry no claim; the super portal has no Tenant. A member blocked at a studio is refused a session there and nowhere else. It is the only authenticated Tenant statement — see `docs/adr/0004-self-hosted-auth-with-better-auth.md`.
_Avoid_: tenant_id (the column is deliberately not named that — see `db/schema/auth.ts`), org claim

**Auth event**:
One row in `auth_events`: a sign-in, sign-out, failed sign-in (a refused password), code sent, code failed (a refused one-time code or second factor), or impersonation start or end, with the pool, the actor's auth user id, the subject for impersonation, the client address and user agent. Written from each pool's Better Auth hooks (`services/auth/auth-events.ts`), in the request's own transaction. Never the address tried, a password or a code: a failed sign-in for an address with no account names no actor. A studio pool's event is filed under the Tenant whose context is open; a `platform` event under none — the one **Platform row**. An impersonation is filed under `staff`: the acting **Admin**'s staff auth user is the actor, the member's client auth user the subject. Its start is written by `openImpersonationSession` (`services/auth/better-auth.ts`), which opens the session outside any endpoint; its end by the hook, when that session is signed out. A staff member's act on someone else's account from their detail view — `sessions_revoked`, `user_blocked`, `user_unblocked`, `invitation_resent`, `member_data_exported` — has the same shape: filed under `staff`, the acting staff member as actor, the member or staff member acted on as subject (`recordStaffAct`, `services/auth/staff-acts.ts`).
_Avoid_: login log; bare "audit log" when `audit_log` (staff actions on domain rows) could be meant — say "sign-in audit log"

**Platform row**:
A row with a null `tenant_id` in a table that allows one — `auth_events` only, named in `PLATFORM_ROWS` (`db/roles.ts`). Its policy matches with `IS NOT DISTINCT FROM`, so inside a Tenant context a query sees that Tenant's rows and nothing else, and outside every context — where the super portal runs — only the platform's.

**Application role** (`booking_app`):
The Postgres role the running server connects as, provisioned by `db/roles.ts` and reached through `DATABASE_APP_URL`. It owns no tables and is neither superuser nor `BYPASSRLS`, which is the *only* reason the policies apply — Postgres exempts superusers unconditionally and owners unless the table is `FORCE`d, so a server connected as the owner in `DATABASE_URL` would pass every test while enforcing nothing. Migrations and seeds still run as the owner, which is how they write across Tenants.

`tenant_settings` is the one Tenant-scoped table with no policy, because slug resolution reads it to *establish* the context a policy would key on. Column privileges stand in: the role may read the branding a studio publishes (`TenantDisplaySettings` in `services/tenants/tenants.ts`) and nothing else, so the mail-from identity and waiver text are unreadable across Tenants. The grant is by name, so a column added later is invisible until someone declares it public.
_Avoid_: db user, service account

**Tenant routing**:
Answering "whose is this?" for a caller that arrives with no Tenant at all — a webhook, which hits one endpoint on a hostname carrying none. Something in the *signed body* is the routing key, and looking it up is a cross-Tenant read the application role cannot make, so it goes through an owner-owned `SECURITY DEFINER` function (migration 0034) that returns Tenant ids and nothing else. Everything after runs inside `withTenant`. Narrow steps, deliberately, rather than a standing exemption.

The payment provider's webhook routes off the payment intent. The mail provider's webhook needs no lookup: the send path stamped the Tenant id on the message as a tag, the event carries it back under the provider's signature, and `withTenant` on that id lets RLS confine the update to that Tenant's `email_log`. An event that names no Tenant is a logged no-op — never a default.
_Avoid_: webhook tenant, tenant lookup

**Per-Tenant identity**:
`clients` and `staff_users` are unique on `(tenant_id, auth_user_id)` and `(tenant_id, email)`, not on either column alone (migrations 0035 and 0047). `auth_user_id` is `NOT NULL` (0052): every row is linked to a pool user by whatever wrote it. The platform-wide version was the same sentence as "nobody may belong to two studios" — a case the spec wants to work — and it failed at sign-up as a duplicate-key error. One person, two studios, two independent records, one at each.

### Staff

**Staff role**:
What a staff member of one Tenant may do in that studio's portal — exactly two, **Admin** and **Instructor**, and nothing else (`staff_role` in Postgres). Ranked Admin above Instructor: nobody may edit a staff member who outranks them, and only an Admin may change anyone's role. A role is per Tenant, like the `staff_users` row it sits on. See `docs/adr/0006-two-staff-roles.md`.
_Avoid_: owner, main admin, permission level

**Admin**:
A staff member who runs the studio: its catalogue, locations, policy, waiver, notifications and feature flags; its staff, including other Admins; its members, read and write; and **Impersonation**. Sees every active location of the studio — there are no per-location grants. The first staff member of a Tenant created or restored from the super portal is an Admin.
_Avoid_: studio owner, manager

**Instructor**:
A staff member who teaches. Reaches the instructor surfaces only, is refused every admin-only surface, and is the only role that applies for leave.
_Avoid_: teacher, coach, trainer

**Last-admin guard**:
The rule that a studio always keeps one active Admin. Archiving a staff member, or changing their role away from Admin, is refused when they are the studio's only active Admin — role Admin, status active, not soft-deleted. The count and the write share one transaction, so two concurrent removals cannot both pass. Deleting needs an already-archived row, so it needs no check of its own; signing someone out is not guarded, because they can sign back in. Separately, nobody may change their own role or archive themselves.
_Avoid_: owner lock

**Impersonation**:
An Admin signing in as one of the studio's members, to see what they see. It opens a `client` pool session on the member's behalf, carrying a signed grant that names the acting staff member, and is recorded as an **Auth event** under `staff` at start and end.
_Avoid_: act-as, masquerade, login-as

**Platform administrator**:
The operator of the super portal, signed in through the `platform` pool and named by `PLATFORM_ADMIN_EMAILS`. Not a staff member of any Tenant, holds no **Staff role**, and has no row in `staff_users` — creating or restoring a studio is the platform administrator's; running one is its Admins'. Never confused with an Admin: an Admin's powers stop at their own studio, and a platform administrator's start outside every studio.
_Avoid_: root, platform owner, bare "admin" (which is the studio role)

### Packages and locations

**Location**:
One of a Tenant's physical premises. Locations belong to the Tenant, not to the platform, and a Tenant has as many as it has — one, two, a dozen, or none yet. A class runs at exactly one Location, and no rule anywhere may assume a particular number.
_Avoid_: branch, studio, venue, outlet, site

**Unlimited Plan**:
A purchased plan that pays for any class at its Home Location, as often as the member likes, until it expires. Distinct from a Credit Bundle, which pays per class.
_Avoid_: membership, subscription, unlimited package

**Credit Bundle**:
A purchased balance of credits, each booking deducting the class's cost. Location-agnostic — credits work at any of the Tenant's Locations.
_Avoid_: pack, class pack, points

**Home Location**:
The one Location an Unlimited Plan covers, chosen by the member at purchase. Only an Unlimited Plan has one; no other kind of plan carries a Location.
_Avoid_: home branch, primary location, base studio

**Cross-Location Add-On**:
A paid extension to one Unlimited Plan that makes it Cover every one of the Tenant's Locations, not just its Home Location — it is a flag on the plan, not a second Location on it (`covers` in `services/packages/selection.ts`). Named for the two-Location studio it was written for; a Tenant with three Locations gets all three from one Add-On. Priced per month of the plan it extends, rounded up to a whole month. It belongs to that one plan, not to the member: it expires with the plan, waits Dormant with the plan, and a member holding two plans buys one per plan.
_Avoid_: cross-branch top-up, second branch unlock, upgrade, dual-location pass

**Covers**:
The relation between a plan and a Location — the plan permits a free booking there. An Unlimited Plan covers its Home Location; it also covers every other Location of that Tenant while it carries a Cross-Location Add-On. It never covers a Location of another Tenant — a plan sold by one studio is not a candidate for a class at another, which is enforced at the one place credits are chosen to be spent (`services/bookings/book.ts`).
_Avoid_: includes, allows, valid at

**Duration**:
How long an Unlimited Plan runs, counted in whole calendar months. A 6-month plan Activated on 15 January ends on 15 July, not 180 days later. Where a month has no matching day the end date falls on the last day of that month — 31 August plus 6 months ends 28 February.
_Avoid_: length, term, validity, duration days

**Dormant**:
A package that is paid for but whose clock has not started. **Every** package is Dormant from purchase — Credit Bundle, Unlimited Plan, trial and PT package alike — and stays so until the first booking it pays for. A member may hold any number of Dormant packages; they wait in the order they were bought. A null `expires_at` means Dormant and nothing else. Contrast **Activated** — clock running, end date fixed. (Before ADR 0004 only an Unlimited Plan bought behind another could be Dormant; everything else started its clock at purchase.)
_Avoid_: pending, inactive, unused, scheduled, queued

**Activation**:
The moment a Dormant package starts its clock: the first booking it pays for — a confirmed class booking for the class family, a session request for a PT package. It can only happen once the package in front of it in the same Family has ended. The end date is fixed at that moment: one Duration forward for an Unlimited Plan, `validity_days` forward for every other kind, both frozen onto the purchase. A member who stops attending keeps the package waiting and loses none of it. Activation happens once and never reverses on its own; only staff can return a package to Dormant.
_Avoid_: start, redemption, kick-off, going live

**Family**:
The two groups within which **one package is Activated at a time**. The **class family** is Credit Bundle, Unlimited Plan and trial — they all pay for classes, so they queue behind one another. The **PT family** is PT packages alone. While a package is running it is the only one in its Family that can pay, whatever the member asks: a running Unlimited Plan cannot be stepped around with waiting credits, and a running 1-on-1 PT package holds a waiting 2-on-1 one behind it. A package has **ended** — and frees its Family's slot — when it expires, is spent to zero, or is refunded. Enforced by two partial unique indexes on `client_packages` (`…_one_activated_class_per_client`, `…_one_activated_pt_per_client`).
_Avoid_: category, group, pool, type (which means the catalogue kind)

**Instructor-Bound**:
A property of a PT Package **in the catalogue**: buying it means choosing one instructor, and the purchase lands tied to them. An admin turns it on per package; it is off by default. It is a question asked at checkout and nothing else — it is never copied onto what the member buys, so turning it on or off moves future sales only and cannot reach a package already sold. A PT Package that is not Instructor-Bound asks the member nothing and is open to any instructor.
_Avoid_: dedicated, assigned, exclusive, locked, instructor-specific

**Bound Instructor**:
The one instructor a **purchased** PT Package's sessions are with. It is a single nullable column on the purchased row, and it IS the binding: "bound" means exactly that the column is filled, which is why a package sold open can be bound later without a second flag going stale. Only a PT Package can have one. It must be an active instructor of the Tenant at the moment it is set; a Bound Instructor later archived stays bound and visibly so, rather than the package silently reopening. An admin sets, changes or clears it at any time from the member's profile, with a reason and a ledger row; the change reaches future scheduling only and never moves a session already on the calendar.
_Avoid_: owner, assigned instructor, coach, trainer, preferred instructor

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
A price cut the member must type at checkout to receive. One code reaches across products, and it may be capped in total and is always capped at one use per member. Its text is unique **per Tenant**, not across the platform: two studios each running a code called SUMMER is normal, and a member typing it always gets their own studio's terms. Contrast a **Promotion**, which applies itself.
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
