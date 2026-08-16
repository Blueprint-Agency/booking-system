# Pre-launch batch: Home Location, Promo Codes, purchase emails, leave caps

Collapsed from the wayfinder map *Wayfinder: promo codes, location-bound unlimited, leave rules, purchase emails* (issue #3) and its thirteen resolved decision tickets (#4–#16). Every decision below was settled with the studio during charting; nothing here is an open question.

**Status**: ready to build. **Vocabulary**: binding — `be/CONTEXT.md` is the glossary and this spec uses it verbatim.

---

## Problem Statement

Yoga Sadhana is pre-launch. Production holds zero rows; staging holds five test accounts and three purchases from a single manual checkout run. Before the first real member arrives, four things the studio has asked for do not work:

1. **The studio cannot run a discount campaign.** Two promo codes are hardcoded in a source file — absolute SGD only, no expiry, no usage cap, no product scoping, and no way for an admin to create or change one without a deploy. Worse, the one page that accepts a code is unreachable: members buy one-click from the catalogue, so the live purchase path takes no code at all. And a mistyped code sent to the checkout endpoint is silently ignored — the member is charged full price while the interface still shows the code as accepted.

2. **An Unlimited Plan cannot be sold per Location.** The studio runs two premises and wants one plan to cover one of them, with a paid add-on for the other. Today a plan carries no Location at all and booking takes any active Unlimited Plan for any class anywhere. The catalogue actively advertises the opposite — "Valid across both locations" — which gives the add-on away before it exists.

3. **A member who buys anything is told nothing.** Templates for package and workshop confirmations exist, are seeded, and have declared variables. No code path sends either. Four separate purchase routes — paid packages, paid workshops, free trial passes, free workshop tiers — all complete in silence.

4. **Instructors have no study leave, and nothing stops the studio losing all its cover at once.** Leave is annual or medical only. Every rule concerns one instructor's own pool or their own teaching schedule; nothing in the system has ever compared two instructors, so there is no way to say "not everybody at once".

Underneath all four sits a fifth problem that only becomes visible once they ship: **the system does not record what anything cost.** Only the amount paid is stored, and the price it was cut from lives on an admin-editable catalogue row. The moment a package is repriced, every past discount becomes unrecoverable. Workshop revenue is already in this state.

There are also no refunds. The refund service throws `not implemented`, and the refund webhook flips a payment status and unwinds nothing — so a member who is refunded keeps their entitlement and their booked classes.

---

## Solution

Nine changes, shipped as one batch before launch, while production is still empty and every migration is a plain `ALTER TABLE`.

**An Unlimited Plan gains a Home Location** — one column, chosen by the member at checkout, enforced by a database constraint. Booking filters candidate plans to the class's Location and refuses `location_not_covered` rather than silently burning credits. A **Cross-Location Add-On** — a nullable money column on the plan, priced from a rate on Global Policy — makes one plan cover both Locations.

**An Unlimited Plan bought as a renewal starts Dormant.** A null expiry means Dormant and nothing else; "never expires" leaves the domain entirely. The plan's clock starts at its first confirmed booking, and its Duration is frozen onto the purchase in calendar months so an admin editing the catalogue cannot lengthen something already sold.

**A Promo Code becomes a real domain object** in its own tables — typed by the member, reaching across products, capped globally and always capped at one use per member. The cap is hard, enforced by a Hold taken at checkout that lapses on its own. Every failure gets a member-facing reason, and checkout refuses a bad code instead of quietly charging full price.

**Checkout gains a review step.** The dead `/checkout` page comes alive and every paid purchase routes through it — because it is the only surface in the member app with a code input, and the Location picker and the Add-On maths need somewhere to live. Free grants keep their one-click path.

**Four purchase paths send a confirmation email.** Comp grants deliberately send nothing. Every variable in these templates is a whole composed sentence built in code, because the renderer is substitution-only and one template must serve five package kinds without promising activation to a Credit Bundle.

**A Refund becomes a portal action** that voids the purchase, cancels every future booking on it, and hands the Promo Code back. There is no partial refund and no separate admin revoke.

**List Price freezes onto every purchase**, including free ones, so a giveaway reads as a 100% discount rather than as nothing at all. Bookings gain money columns for workshops. The report that reads them is explicitly not built here.

**Study leave becomes a third Leave Type**, deliberately the least exceptional of the three — seven days a year, no carry-over, and the medical certificate generalises into a **Supporting Document**.

**A Leave Cap** — one pure rule used twice — refuses leave that would put too many instructors away at the same instant. One cap over a **Cover Group** counting every Leave Type, one studio-wide cap counting study leave only. Medical leave counts toward a cap and is never refused by one.

---

## User Stories

### Buying an Unlimited Plan

1. As a member, I want to choose which studio my Unlimited Plan covers when I buy it, so that I pay for the location I actually attend.
2. As a member, I want the studio choice to have no pre-selected default, so that I cannot pay for the wrong location by not noticing a control.
3. As a member, I want my chosen studio restated immediately above the Pay button, so that I pass the irreversible choice twice before money moves.
4. As a member, I want each studio option to show its address, so that I am choosing between places rather than between names.
5. As a member, I want to be unable to reach a Pay button until I have chosen a studio, so that the choice cannot be skipped.
6. As a member renewing while my current plan is still running, I want to see my existing studio shown as fixed rather than as a choice, so that I am not offered an option the system will refuse.
7. As a member renewing, I want to be told how to move my plan to the other studio if I need to, so that a locked control does not read as a dead end.
8. As a member, I want the catalogue to say an Unlimited Plan covers one studio chosen at checkout, so that I am not told it covers both and then discover otherwise.
9. As a member, I want my plan's Duration counted in calendar months, so that six months bought on 15 January runs to 15 July rather than to an arbitrary day 180 days out.

### The Cross-Location Add-On

10. As a member, I want to add the second studio to my plan for a monthly rate, so that I can attend classes at both without buying a second plan.
11. As a member, I want the Add-On offered on the same page as the plan I am buying, so that I can decide once rather than come back later.
12. As a member, I want the Add-On control to stay visible with its rate showing while it is unavailable, so that I can see what is on offer before I qualify for it.
13. As a member, I want a disabled Add-On to tell me the precondition rather than say "unavailable", so that I know it is *not yet* rather than *broken*.
14. As a member, I want the Add-On's arithmetic shown — months times rate equals total — so that the number is explained rather than asserted.
15. As a member buying the Add-On against a part-used plan, I want to be told that part months are charged as whole months *before* I see the total, so that the surprising part is answered before it provokes the question.
16. As a member, I want the Add-On to expire with the plan it extends, so that I never hold coverage for a plan I no longer have.
17. As a member holding both a running plan and a queued renewal, I want to buy an Add-On for each, so that I can keep unbroken access to both studios across the handover.
18. As a member, I want to buy the Add-On later against a plan I already hold, so that I am not forced to decide at the original purchase.
19. As a member with no Unlimited Plan, I want the Add-On to tell me it has nothing to attach to and route me to the plans, so that I am not blocked by a control I cannot understand.
20. As a member whose plan already carries an Add-On, I want to be told so rather than allowed to buy a second, so that I cannot pay twice for the same thing.
21. As a member, I want to be told on my plan card when cross-location coverage is coming to an end, so that losing it is never silent.

### Booking with a Location-bound plan

22. As a member, I want to see classes at the studio my plan does not cover rather than have them hidden, so that I know what the studio offers.
23. As a member, I want a class outside my plan's coverage to say plainly which studio my plan covers, so that the refusal explains itself.
24. As a member looking at a class outside my coverage, I want the option to buy the Add-On, so that the block comes with a way through it.
25. As a member holding both an Unlimited Plan and credits, I want the option to spend a credit on a class outside my plan's coverage, so that I am not trapped by holding the wrong plan.
26. As a member, I want a class outside my coverage never to silently spend my credits, so that I always know what I paid with.
27. As a member, I want the blocked-class treatment to be quiet and repeatable, so that browsing a week of classes at the other studio does not read as a column of adverts.
28. As a member, I want a class I have already booked to stay booked if my plan's coverage later changes, so that the studio honours what it accepted.

### Activation and Dormant plans

29. As a member buying an Unlimited Plan when I hold no live plan, I want it to start immediately, so that I can book straight away.
30. As a member buying a renewal while my current plan still runs, I want the new plan to wait rather than run alongside, so that I lose none of what I paid for.
31. As a member with a waiting plan, I want it to start on my first booking after the old one ends, so that a gap in my attendance costs me nothing.
32. As a member, I want a waiting plan to say "starts when you book your first class" rather than show a blank date, so that its state is legible.
33. As a member, I want a waiting plan's full length available when it starts, so that queueing a renewal is never worse than buying late.
34. As a member, I want to be prevented from booking a class so far ahead that my plan would expire before the class runs, so that a booking cannot invalidate the plan that paid for it.
35. As a member who chooses to pay with credits, I want my waiting plan to stay waiting, so that spending a credit does not start a clock I did not mean to start.

### Promo Codes — member

36. As a member, I want to type a discount code at checkout, so that I can use an offer the studio has sent me.
37. As a member, I want a code I typed in lower case or with stray spaces to work, so that I am not punished for how I copied it.
38. As a member, I want a code to be checked against the specific thing I am buying, so that a green tick is not contradicted by a refusal seconds later.
39. As a member typing an expired code, I want to be told it has expired, so that I stop retyping it.
40. As a member typing a code that has run out, I want to be told it has been fully claimed, so that I understand it is not my mistake.
41. As a member typing a code I have already used, I want to be told so, so that I know the offer was one per person.
42. As a member typing a code that does not cover what I am buying, I want to be told which product it does not apply to, so that I can use it on something else.
43. As a member typing a code that does not exist, I want one plain message, so that the checkout is not a guessing game for codes.
44. As a member, I want checkout to refuse a bad code outright, so that I am never charged full price while the screen shows the code as accepted.
45. As a member who has completed payment, I want never to be told afterwards that the code ran out, so that a race between shoppers is not settled at my expense.
46. As a member whose discount takes the total to zero, I want the purchase to complete without a payment step, so that I am not sent to a card form for nothing.
47. As a member, I want a code's discount to stack on top of a sale the studio is already running, so that an advertised offer means what it says.

### Promo Codes — admin

48. As an admin, I want to create a Promo Code from the portal, so that running a campaign does not need a developer or a deploy.
49. As an admin, I want to choose between a percentage off and a fixed amount off, so that I can run either shape of offer.
50. As an admin, I want the system to generate a code for me from an unambiguous alphabet, so that members reading it aloud do not confuse zero with O.
51. As an admin, I want to type my own memorable code, so that a campaign can carry a name.
52. As an admin, I want a custom code to be unable to collide with a generated one, so that two campaigns cannot share an identity.
53. As an admin, I want to set a total usage cap, so that an offer cannot cost more than I budgeted.
54. As an admin, I want to leave the cap empty, so that an evergreen partner code needs no maintenance.
55. As an admin, I want to set an expiry date, so that a seasonal offer closes itself.
56. As an admin, I want to leave the expiry empty, so that a permanent code needs no diary entry.
57. As an admin, I want the total cap to be genuinely hard, so that a popular code cannot overshoot the budget.
58. As an admin, I want every code limited to one use per member automatically, so that I never have to remember to set it.
59. As an admin, I want to scope a code to specific products or to everything, so that one code can be as broad or as narrow as the campaign needs.
60. As an admin, I want to scope a code to a whole workshop rather than to one of its ticket tiers, so that a member who bought the wrong tier is not a support ticket.
61. As an admin, I want corporate packages excluded from codes entirely, so that direct-pay corporate pricing stays untouched.
62. As an admin, I want to edit a live code's label, expiry, cap and product list, so that a running campaign can be adjusted.
63. As an admin, I want a code's text and its discount frozen once someone has used it, so that I cannot rewrite terms a member has already accepted.
64. As an admin, I want to archive a code, so that I can stop it without deleting the record of what it did.
65. As an admin, I want archiving to leave in-flight checkouts to finish or lapse on their own, so that stopping a code does not fail someone mid-payment.
66. As an admin, I want the Promo Code screen to sit alongside Packages rather than inside one package's editor, so that its reach across products is visible in where it lives.

### Purchase confirmation emails

67. As a member, I want an email when I buy a package, so that I have a record of what I bought.
68. As a member, I want an email when I book a workshop, so that I have my confirmation and QR code in writing.
69. As a member, I want an email when I claim a free trial pass, so that my first contact with the studio is a welcome rather than silence.
70. As a member, I want an email when I book a free workshop tier, so that a zero-price booking is confirmed like any other.
71. As a member buying an Unlimited Plan, I want to be told my plan activates on my first booking, worded as a benefit, so that a null expiry date reads as a promise rather than a gap.
72. As a member buying a Credit Bundle, I want a real expiry date and no mention of activation, so that I am not told a rule that does not apply to me.
73. As a member, I want my confirmation email to carry a working link, so that clicking it never leads nowhere.
74. As a member on a free purchase, I want that link to take me to my account, so that a receipt-shaped link is not empty just because no money moved.
75. As a member, I want one confirmation per purchase however many times the payment provider retries, so that I am not emailed repeatedly for one transaction.
76. As a member, I want my purchase to succeed even if the confirmation email fails, so that a mail problem never costs me what I paid for.
77. As a member whose record an admin quietly corrected with a complimentary grant, I want no email announcing it, so that a back-office repair is not addressed to me as a purchase.

### Refunds

78. As an admin, I want a refund button on each purchase on the client detail page, so that I do not have to leave the portal to return money.
79. As an admin, I want the refund to always be the full amount, so that there is no amount field to get wrong.
80. As an admin, I want to see how many classes have been attended on a purchase before I refund it, so that I know when I am going against the studio's rule.
81. As an admin, I want to be able to refund anyway after being told, so that a genuine case is not blocked by a rule that could never be enforced.
82. As an admin, I want to type a reason for every refund, so that there is a record of why.
83. As an admin, I want a refund issued from the payment provider's own dashboard to unwind exactly like one issued from the portal, so that the two can never diverge.
84. As a member who is refunded, I want my future booked classes cancelled rather than left dangling, so that I am not holding seats for a plan I no longer have.
85. As a member who is refunded, I want an email naming the classes that were cancelled, so that I am not left to discover it at the door.
86. As a member who is refunded, I want the classes I already attended to stand as history, so that the studio's records and its instructors' pay are not rewritten.
87. As a member who is refunded, I want the code I used returned to me, so that a purchase I no longer have does not consume my one use.
88. As an admin, I want a refunded code's place returned to its pool, so that a cancelled sale does not permanently consume budget.
89. As an admin, I want refunded uses kept on record rather than deleted, so that repeated buy-and-refund is visible.
90. As a member whose classes are cancelled by a refund, I want the waitlist promoted as normal, so that the seats go to somebody.

### Revenue that can be reconstructed

91. As an admin, I want the price a product was listed at recorded on every purchase, so that a later catalogue change cannot hide what a member was charged.
92. As an admin, I want free and complimentary purchases to record a list price too, so that a giveaway shows up as a full discount rather than as nothing.
93. As an admin, I want workshop bookings to record what was charged, so that workshop revenue is not re-derived from an editable ticket price.
94. As an admin, I want to see, per member, the list price, the discount, which code was typed, the Add-On amount and the home studio, so that "what did this person pay, and why" is answerable today.
95. As an admin, I want Add-On revenue kept separate from plan revenue, so that I can tell whether the Add-On is selling.
96. As an admin, I want a Promo Code never to discount the Add-On, so that a percentage code cannot quietly shave a rate I set by hand.

### Study leave

97. As an instructor, I want to request study leave, so that a course is not booked against my annual allowance.
98. As an instructor, I want seven study days a year by default, so that I do not have to ask for an allowance to be created.
99. As an instructor, I want to attach a course confirmation to a study leave request, so that an admin can see why I am asking.
100. As an instructor, I want the attachment to be optional, so that I can file the request before the confirmation arrives.
101. As an instructor, I want to take a half day of study leave, so that a morning exam does not cost a whole day.
102. As an instructor, I want study leave to be refused if it starts today or earlier, so that the rule matches how annual leave already behaves.
103. As an instructor, I want unused study days to expire at year end rather than carry, so that the allowance is clearly use-it-or-lose-it.
104. As an admin, I want to raise one instructor's study allowance, so that a longer course can be accommodated deliberately.
105. As an admin, I want to see and adjust study leave beside annual and medical, so that the third type is not a special case in the interface.
106. As an admin, I want the medical certificate concept renamed to Supporting Document throughout, so that a column holding course confirmations does not read as a bug.
107. As an admin, I want documents already uploaded to keep working after the rename, so that the change costs no data migration.
108. As an instructor, I want a Supporting Document refused on annual leave, so that the attachment means something.

### Leave caps

109. As an admin, I want to mark which instructors cover each other, so that the system knows who must not all be away at once.
110. As an admin, I want the cover rule inert until I mark somebody, so that the studio does not wake up to refusals it did not ask for.
111. As an admin, I want to set how many of that group may be away at once, so that the rule is a number I control rather than a hardcoded "one".
112. As an admin, I want a separate studio-wide cap on how many instructors may be on study leave at once, so that courses are staggered without freezing ordinary leave.
113. As an admin, I want the study cap to count study leave only, so that one person's holiday does not block everybody's courses.
114. As an admin, I want the cover cap to count every kind of leave, so that the group's cover is measured by who is actually absent.
115. As an instructor, I want a request refused only when it would genuinely put too many people away at the same moment, so that leave that never coincides is not refused.
116. As an instructor, I want my morning half day not to clash with a colleague's afternoon half day, so that the rule is as precise as the leave it measures.
117. As an instructor, I want a refusal to name the colleagues already away, so that I can settle it with them rather than go to an admin to ask who.
118. As an instructor, I want a refusal never to say why a colleague is away, so that the rule leaks nothing the who's-away view does not already show.
119. As an instructor, I want a pending request to hold the day, so that first to ask is first served rather than the decision being deferred to an admin.
120. As an instructor, I want the refusal at submission rather than at approval, so that I find out immediately and can pick another day.
121. As an instructor, I want a rejected request to free the day at once, so that a colleague is not blocked by a request that no longer exists.
122. As an instructor, I want medical leave never refused by a cap, so that being ill is never rationed.
123. As an admin, I want to be told in the submission email when a medical request puts the studio over a cap, so that I can arrange cover in time.
124. As an admin, I want over-cap days marked on the leave calendar, so that I can see the pressure as well as be told about it.
125. As an admin, I want lowering a cap not to disturb leave already approved, so that a policy change is never retroactive.
126. As an admin, I want raising a cap temporarily to be the way to make an exception, so that exceptions are visible and audited rather than hidden behind an override.

### Staff corrections

127. As an admin, I want to change a member's home studio, so that a member who picked the wrong one at checkout can be moved.
128. As an admin, I want that change to move both their running plan and any queued renewal together, so that the two cannot end up disagreeing.
129. As an admin, I want the change audited, so that there is a record of who moved what.
130. As an admin, I want a member's existing bookings to survive a studio change, so that correcting a record does not cancel their classes.
131. As an admin, I want to attach or remove a Cross-Location Add-On from the client detail page with a reason, so that I can fix a purchase that went wrong.
132. As an admin, I want to return an activated plan to Dormant, so that I can undo an activation caused by a class the studio itself cancelled.
133. As an admin, I want to be warned before archiving a Location that members' plans point at, so that I know what I am about to strand.

---

## Implementation Decisions

### 1. Home Location on the Unlimited Plan

**The column.** `client_packages` gains `location_id`, a uuid foreign key to `locations` with `onDelete: 'restrict'`, matching how classes reference a Location.

**The constraint.** Folded together with the activation rules below into one check, `client_packages_kind_fields`, in the shape the catalogue table already uses:

```
(kind = 'unlimited'
   AND location_id     IS NOT NULL
   AND duration_months IS NOT NULL)
OR
(kind <> 'unlimited'
   AND location_id     IS NULL
   AND duration_months IS NULL
   AND expires_at      IS NOT NULL)
```

Strict, with no grandfathering. The backfill probe confirmed zero Unlimited Plans exist in either database, so this is a plain `ALTER TABLE` against three non-unlimited rows that already satisfy the second arm. An unusable plan becomes impossible at the database level rather than something booking has to detect.

**Rejected**: a `client_package_locations` coverage table. Two Locations exist and the Add-On covers *all* of them rather than an arbitrary set, so it would be a join table for a set of size one or two. Revisit only if a third premises opens and members start buying pairs.

**Nothing else gains a Location.** Credit Bundles, trial passes, PT sessions and workshops are untouched — PT and workshops already carry their own Location handling on their own rows.

### 2. Which plan pays for a booking

The package-selection decision moves out of the booking transaction and into a pure module, `services/packages/selection`. The booking service loads rows, locks them, and calls in; the module returns which package pays and why, or a refusal. The order:

1. Candidate Unlimited Plans are those whose `location_id` equals the class's Location **or** whose `cross_location_paid_sgd` is non-null.
2. Candidates are ordered **Activated first** (`expires_at IS NOT NULL`), soonest-expiring, with Dormant plans last. The existing comparator already sorts a null expiry as infinity, so this reuses the credit-bundle sort unchanged.
3. A candidate must be valid when the class actually runs. For an Activated plan that is today's test. For a Dormant plan the test is **prospective**: `now + duration_months >= class start`. Without this a member with a three-month plan booking four months out would activate the plan and instantly invalidate it for the very class that activated it.
4. No covering Unlimited Plan → refuse with `409 location_not_covered`. **Not** a silent fall-through to credits.
5. Unless the caller passes `use_credits: true`, in which case selection continues into the existing credit-bundle and trial branch unchanged.

Point 5 deliberately breaks the "server picks the package, no client input" rule the booking service documents. It is the only way to honour "shown, blocked, and upsold" without stranding a member who holds both a plan for one Location and paid credits.

**Coverage is tested once, at booking, and never re-tested.** A confirmed booking was paid for by the plan that covered it at the time. A member who books at the other Location and then renews without an Add-On keeps that booking.

### 3. Activation, and what a null expiry means

**A null `expires_at` means Dormant, and nothing else.** "Never expires" leaves the domain.

| Case | Clock starts | `expires_at` at purchase |
|---|---|---|
| Buys an Unlimited Plan holding no live plan | At purchase | Stamped immediately |
| Buys a renewal while one is still live | At Activation | Null until then |

**No new column for dormancy** — `expires_at IS NULL` *is* the test, which the Location work already committed to for both the booking sort and its uniqueness index. An `activated_at` column would buy an audit trail that end-date-minus-Duration already derives.

**Only an Unlimited Plan can be Dormant.** Credit Bundles hold their value in a balance rather than a clock; a trial is a single class; PT runs a fixed 365 days through a separate path. The payoff is that activation lives in exactly one function and nothing else in the system learns about dormancy.

Two changes fence "never expires" out: `class_packages.validity_days` becomes **required for trials** (the catalogue check allows null today), and the folded `client_packages_kind_fields` above makes an absent expiry impossible for every non-unlimited kind.

**The activation event** is the first confirmed class booking the plan pays for — not a waitlist join, not a PT request, not a workshop booking. It is stamped inside the booking transaction that already holds the package rows locked, so there is one writer and no race. The end date is `now + duration_months` counted from the booking moment, **not** from the class date — counting from the class date would let a member book the furthest-out class on the schedule for a free extension.

**Activation is one-way.** No cancellation un-stamps it, from any actor. Reversing automatically would mean deciding what a second and third cancellation do and whether start dates can be farmed. Staff handle the rare genuine case by returning the plan to Dormant by hand.

A member who passes `use_credits: true` books on credits and **their plan stays Dormant**.

### 4. Duration is calendar months, frozen at purchase

`class_packages.duration_days` becomes **`duration_months`**, and `client_packages` gains a frozen `duration_months` copy, required for Unlimited and null for everything else.

Use Postgres `interval` arithmetic, which clamps month-ends correctly for free: 31 August plus six months is 28 February.

The freeze is required, not decorative. Activation needs the length, and the only other source is the live catalogue row — so an admin editing "6-Month Unlimited" would silently lengthen every Dormant plan already sold. Three consumers need this number and all three need the same answer: activation, the Add-On's months-remaining price, and the confirmation email's validity sentence. This is the same pattern the table already runs for the applied promotion.

The expiry helper accordingly returns null for `unlimited`, and the grant path writes `duration_months` instead.

### 5. The Cross-Location Add-On

**A nullable money column on the plan, not a catalogue product.** `client_packages.cross_location_paid_sgd`, numeric(10,2). Null means the plan Covers its Home Location only; non-null means it Covers both, and the value *is* what the member paid.

**Rejected**: a catalogue row. `price_sgd` holds a price, but the Add-On is a **rate** — the charge is `ceil(months) × rate`, which no catalogue row can express. It would also have cost a fourth arm on the catalogue's kind check, a fifth value on the plan-kind enum that the active-flag logic switches on, a second row per member for booking to join, and a shop listing where a member with no plan could try to buy something with nothing to attach to. **Rejected**: a dedicated add-on table, honest but a table for a strict one-to-one.

**The rate lives on Global Policy** as `cross_location_rate_sgd`. That singleton already has admin CRUD and an updated-by-staff audit column, so repricing without a deploy costs one column and no new surface. The rate is read once, at checkout, and never again — repricing moves future purchases only.

**One Add-On per plan, never per member.** It belongs to one plan: it prices at that plan's months, expires with it, and waits Dormant with it. A member holding an Activated plan and a Dormant renewal buys two, one on each. Both surfaces show it per plan, so "both studios until 14 November, then Breadtalk IHQ only" stays a sentence a human can read.

**A Dormant Add-On needs no machinery.** It is a paid column on a row whose expiry is null. It prices at the plan's full stored Duration — no arithmetic. It activates when the plan does, because activation stamps the row it already lives on.

**Pricing**, in `services/packages/validity` beside the Duration arithmetic:

| Plan | Months remaining | Price at a $30 rate |
|---|---|---|
| Dormant, 6-month | 6 — the stored Duration, no arithmetic | $180 |
| Activated 15 Jan → 15 Jul, today 20 Apr | 2 months 25 days, rounded up → 3 | $90 |

**Checkout and the webhook.** Bought with the plan: one payment session, two line items, with the Add-On amount carried as a metadata field that the grant writes into the column in the same insert. Bought later against a live plan: its own session, told apart by a `cross_location_add_on` value on the session's `kind` metadata, which loads the named plan and fills the column on it.

Money splits without overlap — the plan's amount and the Add-On's amount together equal the charge — so plan revenue and Add-On revenue stay separable. The plan's payment-intent column is already taken by the plan's own purchase, so a later standalone Add-On payment has nowhere to sit on that row; it does not need one, because the payments ledger already points a payment at a plan.

**The Add-On has no independent refund.** It dies with the plan, and the refunded amount is plan plus Add-On together.

**Staff** attach or remove an Add-On from the client detail page. Every change writes a manual-adjustment row with a reason and a zero delta — exactly how an expiry-only edit is already recorded. Checkout refuses when the target plan already carries one.

### 6. One Activated plan, and the renewal rule

A member holds **one Activated plan plus at most one Dormant plan**. A third purchase is refused; wanting the other Location means buying the Add-On, not a second plan.

Enforcement is a partial unique index on `(client_id) WHERE kind = 'unlimited' AND active AND expires_at IS NOT NULL`, plus a check in the purchase path for the Dormant one — an index cannot usefully count to two.

**A member holding a live Unlimited Plan may only renew at that plan's existing Home Location.** This closes a hole that would otherwise be structural: with the Location filter applied *first*, a member holding Breadtalk IHQ Activated and Outram Park Dormant who books at Outram Park skips the Activated plan entirely and activates the Dormant one — two Activated plans, and the index rejects the write in the member's face.

Closing it at the purchase makes both plans always share a Home Location, so booking can never reach the Dormant plan on Location grounds. The index stays as a backstop rather than as the enforcement.

**Rejected**: refusing the *booking* instead — it leaves a member holding a plan they cannot use and did not understand they were buying. **Rejected**: allowing two Activated plans and dropping the index — that discards the constraint that catches the real problem.

A renewal bought **after** the old plan has ended is a fresh purchase and may pick any Location freely.

### 7. Changing a Home Location

Admin only, audited — a fourth function beside the existing package adjust/balance/expiry set, and a fourth route beside them, on a route group that already sets an audit target. No frequency limit; staff are trusted.

**A Location switch moves both of a member's plans together.** Otherwise the two-Activated-plans hole re-opens from the other side: switch only the Activated plan and leave a Dormant plan at the old Location behind it, and the next booking there activates the second plan.

**Members cannot switch their own Location** — a self-serve toggle would give away what the Add-On sells.

**An archived Location** does not touch the plans pointing at it; the foreign key restricts deletion. No class can be scheduled at an archived Location, so those members run out of classes and staff move them with the route above. At archive time the portal warns with a count of live plans and does not block.

### 8. What the booking APIs return

The entitlements service gains `unlimitedLocation` — the Location of the plan that would pay for a booking today — surfaced as `unlimited_location` on the member endpoint and the catalogue route, both of which already return an active-unlimited flag. The renewal rule above makes this unambiguous: a member's two plans always agree.

The entitlements and client-package listings also gain **`dormant: boolean`**. The backend returns the flag; neither frontend derives it. Letting each app test "unlimited and no end date" would put a domain rule in two places outside the domain.

Three sites render a null expiry as "No expiry" today and all three are now wrong:

| Surface | Becomes |
|---|---|
| Member wallet card | "Starts when you book your first class" |
| Member unlimited tile (currently renders nothing) | the same line |
| Portal client detail | "Dormant — starts at first booking" |

The portal expiry dialog's blank field changes meaning from "remove expiry" to **"return this plan to Dormant"**, and is offered for Unlimited only; for every other kind the field stops accepting blank. This is the escape hatch the one-way activation rule depends on. The audit line that renders a null expiry as "no expiry" becomes "Dormant".

The class list stays anonymous and cacheable — the member's frontend compares `unlimited_location` against the Location already on every class card. That check is presentation only; the booking service remains the enforcement.

### 9. Promo Codes — the model

**Our own tables, not the payment provider's coupons.** Two of the five rules the studio asked for cannot be expressed natively at any API version: there is no per-customer redemption cap of any kind, and product scoping can never match the inline price data our checkout builds — each session mints a fresh product with an id that cannot be known in advance, and the documented no-match behaviour is *no discount applied*, so a scoped code would silently discount nothing. Native scoping would additionally cost a synced product per class package, per PT package and per workshop tier, and coupons are near-immutable, so "edit this live code" is not implementable. Full findings on the `research/stripe-promo-codes` branch.

**Vocabulary before schema.** Two mechanisms, two words, and the short form is banned. A **Promotion** is studio-published, applies itself, attaches to exactly one product, and is windowed — unchanged. A **Promo Code** must be typed, crosses products, and is capped. A **Redemption** is one member's use of one code. Neither is ever called "promo", "discount", "coupon" or "voucher", in code, copy or docs.

**The existing `promotions` table is not renamed.** Nothing is live so a rename was affordable, but it buys a migration, an enum rename, admin copy churn and doc churn to fix a problem the glossary fixes for free. **Rejected**: one table with a nullable code column — the two share a shape and nothing else, and every query would filter for a null code forever.

**`promo_codes`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | pk |
| code | text | unique, stored normalised (trimmed, upper-cased) |
| label | text | not null — member-visible, e.g. "S$20 off" |
| kind | enum | `percent` \| `amount` |
| percent_off | integer | 1–99 |
| amount_off_sgd | numeric(10,2) | absolute SGD off |
| max_redemptions | integer | nullable — null means uncapped |
| expires_at | timestamptz | nullable — null means never expires |
| applies_to_all | boolean | not null, default false |
| status | enum | `active` \| `archived`, default `active` |
| created_at / updated_at / created_by_staff_id | | same shape as `promotions` |

Check constraints, mirroring the promotions table's kind check:

```
promo_codes_kind_fields:
  (kind = 'percent' AND percent_off IS NOT NULL
     AND percent_off BETWEEN 1 AND 99 AND amount_off_sgd IS NULL)
  OR (kind = 'amount' AND amount_off_sgd IS NOT NULL
     AND amount_off_sgd > 0 AND percent_off IS NULL)

promo_codes_code_format:  code ~ '^[A-Z0-9-]{3,24}$'
promo_codes_max_positive: max_redemptions IS NULL OR max_redemptions > 0
```

**No `special_price` kind** — a code spans many products, so "this costs $89 instead" is meaningless across them. **No `starts_at`** — a Promotion needs a window because it applies itself; a code does nothing until someone hands it out, and `archived` covers "made, not yet running". Both limits are independently nullable and all four combinations are legal.

**`promo_code_products`** — `(promo_code_id, product_type, product_id)` as the primary key. `product_type` is `class_package | pt_package | workshop`. `product_id` carries **no foreign key**, exactly like the promotions table's parent id; referential integrity sits in the service layer. `applies_to_all = true` means no rows, an invariant that spans rows and so is enforced by the service rather than the database.

**`promo_code_redemptions`**

| Column | Type | Notes |
|---|---|---|
| id | uuid | pk |
| promo_code_id | uuid | FK, restrict |
| client_id | uuid | FK, restrict |
| status | enum | `held` \| `consumed` \| `refunded` |
| held_until | timestamptz | not null — when the hold lapses |
| consumed_at | timestamptz | nullable |
| stripe_payment_intent_id | text | nullable — null on a $0 grant |
| discount_sgd | numeric(10,2) | not null — the money actually taken off, frozen |

with

```
unique (promo_code_id, client_id) WHERE status <> 'refunded'
```

That partial unique index does three jobs: it *is* the one-use-per-member rule, it makes the hold idempotent so a member who abandons and retries updates their own row, and it lets a refunded use be returned without deleting the evidence.

**Rejected**: a denormalised used-count on the code row. It is a second source of truth that drifts, and the ledger is needed anyway for the per-member rule.

### 10. Promo Codes — scope, code text, and the hard cap

**Scope.** A code either applies to everything or names its products explicitly. Scoping is at **workshop** level, never workshop tier. **Corporate packages are excluded entirely** — not an unchecked box, not scopable; corporate is direct-pay with no discounts. **The Cross-Location Add-On cannot be discounted** — it is a rate on Global Policy rather than a product, so there is nothing for `promo_code_products` to attach to, and a percentage code can never quietly shave a rate the studio sets by hand. A code discounts the plan line only.

**Code text.** Generated codes are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no `0`/`O`, no `1`/`I`/`L`, because members read them aloud. Custom codes are 3–24 characters of `[A-Z0-9-]`. Both kinds live in **one namespace behind one unique index**, so a custom code cannot collide with a generated one by construction rather than by a check; generation retries on the unique violation. Entry is case- and whitespace-insensitive, and the normalised form is what is stored and compared.

**The cap is hard, and the count never exceeds it.** A Redemption still *counts* on payment success, but the *slot* is claimed when checkout starts, otherwise two members racing for the last slot both get it.

1. Checkout starts. The service locks the code's row, counts used slots, and upserts a `held` row with `held_until = now + 30 minutes`. The row lock serialises the count exactly; contention exists only on a single hot code.
2. The payment session is created with its expiry set to the **same** moment. The provider's 30-minute minimum is why the hold is 30 minutes.
3. Payment succeeds → the webhook flips the row to `consumed` and stamps the time and the payment intent.
4. The member walks away → the hold lapses. Nothing sweeps it.

**A used slot is `status = 'consumed' OR held_until > now()`.** Stale holds stop counting because the query says so — no cron job, no reservation sweeper, no second expiry mechanism to reason about. Because the hold and the payment session end together, payment is refused after the hold lapses, so **a member who has paid can never be told the code ran out** — the outcome the hard cap threatened.

The short session applies **only** when the code carries a cap. Uncapped and code-free checkouts keep the standard 24 hours.

**A discount that takes the total to $0 skips the payment provider entirely** and grants immediately, reusing the path that already exists for the free trial pass and free workshops. The redemption row is written straight to `consumed`. The discount floors at zero and never goes negative — that is the whole of the "cannot drive a package below cost" guard.

**Discounts stack.** The automatic Promotion is already baked into the line amount before the provider sees it, so a code takes its cut of the discounted figure. This is today's ordering and it is preserved.

### 11. Promo Codes — the failure path and the frozen record

Five outcomes, four of them specific:

| Case | Member sees |
|---|---|
| Expired | "This code has expired" |
| Cap reached | "This code has been fully claimed" |
| Already redeemed by them | "You've already used this code" |
| Out of scope | "This code doesn't apply to *{product name}*" |
| Unknown or archived | "We don't recognise that code" |

Unknown and archived deliberately share one message — separating them turns the endpoint into a code-guessing oracle.

**Checkout refuses** with `400 promo_code_invalid` carrying the same reason. Never a silent full-price charge. This is a live bug today: both checkout branches test the validation result with no else, so a mistyped code is ignored and the member pays full price while the interface shows the code as accepted.

**The validation endpoint must take the product alongside the code**, which it does not today — otherwise it cannot answer the scope case and the green tick would contradict the refusal seconds later.

**Frozen onto the purchase**: `applied_promo_code_id` on both `client_packages` and `bookings`, nullable uuid, foreign key with restrict, beside the existing applied-promotion id. The identifier is frozen rather than the label, because staff may edit the label later; the money taken off is frozen on the redemption row. This is a denormalisation of the ledger and it earns its place — the payment intent is null on $0 grants, so the ledger cannot be joined back to the purchase in every case.

**The admin surface** is a new page under Packages, not nested in a package editor: a Promotion nests because it belongs to one product, a Promo Code crosses products and cannot. Editable on a live code: label, expiry, cap, product list, and archive. **Frozen after the first redemption: the code text and the discount** — changing either rewrites terms a member has accepted. To stop a code, archive it; archiving refuses new redemptions and leaves held slots to lapse.

**The two hardcoded codes are deleted outright** — no seed rows, no migration, no trace, and the module holding them goes with them. The studio creates whatever it wants in the admin screen on day one. The backfill probe confirmed neither has ever been used on a completed purchase, so there is no redemption history to preserve. This also removes the referral-code ambiguity for free.

### 12. The checkout review step

**The dead `/checkout` page comes alive, and every paid purchase routes through it.**

The scope is forced rather than chosen. A Promo Code reaches across products and can be scoped to a Credit Bundle or a workshop, but the review page is the **only** surface in the member app with a code input anywhere. Route Unlimited alone through it and every code scoped to anything else is untypeable, and the Promo Code model is unbuildable. So the picker's page and the code's page are the same page, and it serves the whole catalogue.

**Mechanism — one branch, one file.** The catalogue's buy button takes the effective price. Above zero it keeps its existing auth gate — so the login modal and return-to-page behaviour survive rather than being replaced by a bounce to the identity provider — and then pushes to the review page. At zero it keeps today's post-and-grant. No call site restructures; each passes one more prop. A package that a Promotion drives to $0 falls into the free branch for free, because the test is the price and not the kind. The trial card is untouched — it never used the buy button, has its own disclaimer path, and is always free.

**What the review page carries, in order.** Rows marked *(unlimited)* appear only for an Unlimited Plan.

1. **Order summary** — exists.
2. **Home studio** *(unlimited)* — two radios, addresses shown, **no default**. Pay stays disabled and reads "Choose your home studio to continue".
3. **Cross-Location Add-On** *(unlimited)* — a checkbox block, **disabled until a studio is picked**, with the reason in place of the price. Live, it names the other studio, shows the months-times-rate arithmetic, and closes with "Expires with the plan it's attached to."
4. **Promo code** — exists, now with distinct failure reasons.
5. **Breakdown** — the Add-On is its own line, never folded into the plan.
6. **Home studio, restated** — "Your home studio is Breadtalk IHQ for the next 6 months." immediately above Pay, so the member passes the choice twice.
7. **Pay.**

**Greyed copy is always a precondition, never "Unavailable"**, and the rate stays visible while disabled — so the greyed state advertises rather than reads as broken. The Add-On has **three** distinct disabled reasons: no studio picked yet, the plan already carries one, and the member holds no plan at all ("this attaches to an Unlimited plan, and you don't have one yet" — *nothing to attach to*, worded away from *nothing chosen yet*).

**A renewal replaces the radios with a locked row** — "Your renewal continues at Breadtalk IHQ. Ask us if you need to move it." Building the radios unconditionally would offer a choice the backend refuses. **A Dormant renewal's Add-On** prices at the full stored Duration and shows the plain months-times-rate form with no remainder sentence.

**The standalone Add-On purchase** is the same page, entered with the target plan's id. Two entry points: the nudge on a blocked class, and the plan card on the account page. The remainder sentence comes **before** the arithmetic — "Your plan runs to 26 Nov 2026 — 3 months, 10 days left. Part months are charged as whole months, so that's 4." then the multiplication — so the surprising part is answered before the number that provokes the question.

**The blocked class is a nudge, not an ad.** The row dims, takes a "Not in your plan" lock chip where the Book button was, and carries one line under a hairline: "Your plan covers **Breadtalk IHQ** only. [Add Outram Park for $30/month] · or [use 1 credit]". Both are links, weighted below the class itself. The louder treatment — accent border, tinted card, filled button — was rejected on **repetition**, not on looks: this state appears on every wrong-Location class in the schedule, and at that density an offer becomes an ad break.

**Four live defects this closes.** The unreachable checkout page; the "Valid across both locations" bullet on every Unlimited card, which becomes false the day Home Location ships and gives the Add-On away ("Covers one studio — you choose at checkout"); the duration formatter that assumes days, which goes with `duration_days`; and the flat "Invalid promo code" that collapses every failure into one string.

### 13. Purchase confirmation emails

**The load-bearing decision: every variable in these templates is a whole composed sentence.** The renderer is `{{var}}` substitution with HTML-escaping and **no conditionals** — so a template cannot say two things, and any fragment-shaped variable produces a wrong sentence for some package kind. Composing whole lines in code is what keeps one template correct for five kinds without touching the renderer.

**Who sends, and from where:**

| Path | Where | Slug | Condition |
|---|---|---|---|
| Paid class / PT package | webhook, after the grant | branches on the granted `kind` | `created` |
| Paid workshop | webhook, after the workshop booking | `workshop_purchase_confirmed` | `created` |
| $0 trial pass | the free-trial purchase service | `trial_pass_purchase_confirmed` | always |
| **$0 workshop** | the free workshop booking service | `workshop_purchase_confirmed` | always |
| Admin comp grant | — | **none** | never |
| Corporate package | no purchase path exists | — | — |

Two corrections to how this was originally scoped. **A fifth path exists** — the free workshop booking, which produces a confirmed booking with a QR code and a date and no email at all, the worst case in the set. It sends. And **the slug branches on the granted package's kind, not on the code path**: a *priced* trial goes through the payment provider and the webhook, so a path-based branch would send it the paid-package email. One rule — read the package kind — covers both trial routes.

**Comp grants send nothing.** A comp grant is not a purchase: "your purchase is confirmed" is false, a receipt line has nothing to point at, and the member did not initiate it — so the email's job would be to announce an admin's action to someone who did not ask. An admin quietly correcting a record must not trigger a member email. Silence is the correct default and costs nothing to change later.

**Idempotency: the grant tells the caller.** The grant and workshop-booking services return a `created: boolean` alongside the id; their existing early-return branches return false. The caller sends only when `created`. **Not the email log** — its columns carry no key to the thing that was bought, so using it as the guard means a new column, a migration and an index to answer a question the two existing payment-intent unique indexes already answer. Those are the real locks; `created` merely surfaces a fact the function already knows and throws away.

The concurrent-delivery race resolves on its own: both callers read empty, one inserts, the other raises a unique violation, the grant rethrows, the webhook fails, the provider retries, the retry finds the row and returns `created: false`. The winner sent; the loser never does.

**One helper, at the call sites, that cannot throw.** A single purchase-email function in the notifications service, called from the four sites — not inside the grant, because the slug and every composed line differ per caller. **The helper wraps its entire body in try/catch and error reporting**, following the existing email-every-admin pattern. This closes a real hole rather than being defensive habit: the templated-send function swallows SMTP faults but **throws on an unknown template slug**, and thrown from the webhook after a committed grant that fails the delivery, the provider retries, the grant is now found existing, `created` is false, and **the email is lost permanently while the purchase looks fine**. The swallow is what makes the `created` flag safe.

**The variables.** `package_purchase_confirmed` and `trial_pass_purchase_confirmed` carry `client_name`, `package_name`, `contents_line`, `validity_line`, `receipt_url`. Two replacements in the allow-list:

- **`credits_or_sessions` → `contents_line`.** It is null for Unlimited, so any template label around it dangles. Composed: "Unlimited classes" · "10 class credits" · "5 private sessions" · "3 classes".
- **`expires_at` → `validity_line`.** Unlimited is the only kind that can be Dormant at purchase, so it is the only kind with no date to print. Unlimited: "Valid 6 months from your first class — your plan activates when you make your first booking." Every other kind: "Expires 14 Feb 2027". The months figure reads the frozen `duration_months`, so the sentence stays true if an admin later edits the catalogue.

These are **renames rather than additions**, because the portal template editor enforces the allow-list — leaving the old names live would leave the footgun live. **This is what stops the activation promise leaking onto a Credit Bundle**: it is decided by kind at send time, in code, not by copy an admin can edit into the wrong template. The workshop template keeps its declared variables unchanged.

**`receipt_url` is never empty.** The completed-session event carries no charge object, so the webhook retrieves the payment intent with the latest charge expanded and writes the receipt URL to the payments ledger column that has existed since the schema was written and has never been written to. The free paths have no receipt, so the variable **falls back to the account page** — which exists and lists the member's packages — with neutral anchor text ("View your purchase") that is correct either way. An escaped empty value inside an href renders a visible link that goes nowhere; emptiness is not a safe default in a substitution-only renderer.

**The slug set.** `package_purchase_confirmed` exists, variables retargeted, serving credit bundles, unlimited and PT. **`trial_pass_purchase_confirmed` is new** — promised in two spec documents, never added to the slug union and never seeded; a first-timer's welcome and a $150 receipt are not the same email, and with no conditionals in the renderer, different copy has no other home. `workshop_purchase_confirmed` exists, unchanged, now actually sent — paid and free.

**Copy**, approved by the studio:

> **Your package is confirmed**
>
> Hi Sarah,
>
> **Unlimited 6 Months — Breadtalk IHQ**
> Unlimited classes
> Valid 6 months from your first class — your plan activates when you make your first booking.
>
> View your receipt →

> **Welcome to Yoga Sadhana**
>
> Hi Sarah,
>
> Your trial pass is ready — **3 classes**, valid until 30 Sep 2026.
> Book your first class whenever you're ready.
>
> View your account →

Lines two, three and four of the first are the package name, contents line and validity line — each a complete sentence built in code, which is why the same template renders a Credit Bundle without ever mentioning activation.

### 14. Refunds

**A Refund voids the purchase it paid for, cancels every future booking on it, and hands the Promo Code back. There is no partial refund and no separate admin revoke.**

**Where it is issued**: a Refund button on the client detail page, one per purchase, refunding the **full amount always** — there is no amount field anywhere in the portal. The refund service is implemented at last.

**The button only calls the payment provider and returns; the `charge.refunded` webhook does all the unwinding.** The provider's dashboard can never be locked out, so a refund can always arrive off-book. Writing the unwind once, on the webhook, makes a dashboard refund and a button refund indistinguishable by construction. The webhook must therefore be idempotent — every step below is a no-op on a second pass.

**Eligibility is a notice, not a gate.** The studio's rule — once a member has attended a class on the plan, no refund — is enforced by showing it. The button is always present; when the purchase is not **Untouched** a notice sits above it ("3 classes attended since 12 June") and the admin may refund anyway. A gate was rejected because it cannot gate anything while the dashboard exists, and it would strand the genuine cases the studio does want to refund.

**Untouched means no check-in and no no-show** on any booking the purchase paid for. A no-show counts as used — the class ran and the seat was held, and the alternative makes "don't turn up" the way to stay refundable. A class *booked* but not yet held does not count; it simply gets cancelled. A Dormant plan is trivially Untouched.

**The unwind**, on a full refund for a purchase kind in scope:

1. The payment row's status becomes refunded and the time is stamped — today's behaviour, unchanged.
2. The purchase is **Voided**: `active = false`, found via the payments ledger's existing link to the plan. No new column — `active` is the same lever the nightly expiry sweep already pulls, and the payment status records *why* it went down.
3. **Every future booking the purchase paid for is cancelled.** Bookings already attended or no-showed **stand as history** — un-attending a class would rewrite instructor payroll and the studio's attendance record.
4. Those cancellations reuse the existing cancel-booking service with an admin source, so **waitlist promotion comes free**. Their refund outcome is `n_a`: returning a credit to a package that no longer exists is meaningless, and a credit-returned outcome would falsely read as the member being made whole twice.
5. The Cross-Location Add-On dies with the plan — free, since it is a column on the row being voided.

**The Promo Code comes back.** A refunded Redemption is returned to both the member's one-use limit and the code's pool. The status becomes `refunded` and **the row is not deleted** — the ledger is the only evidence of a buy-refund-buy loop, and deleting it would hide exactly the abuse this decision makes possible. Only the unique index changes, to the partial form given above. The used-slot query needs **no change at all**: a refunded row is neither consumed nor still held, so the slot returns to the pool on its own. The exploit is real and was accepted knowingly — it is bounded by a human clicking refund each time, and the refunded rows make it visible.

**There is no partial refund**, not in the portal and not as a concept. The webhook keeps ignoring partials — a partial arriving from the dashboard is a pure money event that touches no entitlement, which is precisely what the code does today. The existing `TODO(refunds slice)` comment is rewritten to say this is **settled, not deferred**. Consequently there is no pro-rating and no refund calculator: giving a part-used member some money back is a goodwill payment made in the dashboard, and it leaves their plan running.

**Scope**: class packages, PT packages and workshops. A refunded workshop payment cancels that booking via the payments ledger's existing booking link. **Corporate is out** — it creates no client-package row, so there is nothing to void.

**The member is told.** One email per refund, new slug `purchase_refunded`, reusing the composed-sentence machinery above. The provider sends its own money receipt; ours is the one that says the plan has ended and names the classes that were cancelled. Cancelling someone's booked classes silently is not acceptable.

**Audit**: a mandatory typed reason on the button, written to the existing audit log as a `purchase_refunded` action, with the override flag and the attended count in the payload. It is the only record of why an admin refunded against the rule.

### 15. Frozen revenue numbers

**The report is not built here.** No reports route is mounted and the portal has no reports page; the PRD specifies six reports with a shared filter set and CSV export, and none of it exists. Payroll is money *out* and cannot carry money in. The only money-in surface anywhere is the client detail page. Building the Revenue report would drag in the whole surface that hosts it — nav entry, filter convention, CSV export, super-admin mirror — and that is pre-existing unbuilt work, not one of these four changes.

**What is kept is the half that is not deferrable.** A report built next year off frozen columns is the same report. A discount that was never recorded at purchase is gone forever, and these changes are about to start generating exactly those numbers.

**`list_price_sgd` freezes onto the purchase.** Today only the amount paid is stored, and the price it was cut from lives on an admin-editable catalogue row, so re-deriving a historical discount would mean replaying percent-versus-special-price arithmetic against rows that have since moved. This is the fourth use of a pattern the codebase already runs three times.

Two numbers stored, the rest derived: **total discount is list price minus amount paid**, and the split between Promotion and Promo Code comes off the two frozen ids when someone actually asks. No stored discount column — that would be a third number free to disagree with the two that matter.

**`list_price_sgd` is NOT NULL on every row, including free ones.** A comp grant and a $0 trial record the real catalogue price against an amount paid of zero, so they read as a 100% discount — which *is* the number the studio wants when it asks what it gave away this month. A zero there would hide the giveaway forever.

**`bookings` gains both `list_price_sgd` and `amount_paid_sgd`**, required for `kind = 'workshop'` and null for every other kind, enforced the way that table already enforces its kind-specific columns. The table stores **no money at all** today, so workshop revenue is re-derived from admin-editable tier prices and **historical workshop revenue is already unreconstructable** — a pre-existing hole this exposes rather than creates. The free workshop path writes a list price with zero paid, same as a comp grant. Class and PT bookings are paid for by a package and their money stays there.

**Per-Location revenue is the plan's Home Location** for Unlimited Plans and the workshop's own Location for workshops. **Everything else is Unattributed** — an explicit bucket, never split and never silently dropped. Attribution by attendance is refused: it splits one payment across two Locations *and* across time, so a month's takings would keep changing for six months after the month closed, and it cannot be computed until the plan expires. This needs **zero new storage**.

**Add-On revenue reports as its own line.** "Is the Add-On selling?" is the first question the studio will ask about a product it just invented, and folding it into plan revenue is the one question folding destroys.

**What staff can see the day this ships**: the client detail page's package rows gain List Price, the discount, which Promo Code was typed, the Add-On amount and the Home Location — fields on an endpoint that already runs. Per-member, no aggregates, no new screen.

**Refunds must net out** of any figure derived from these columns, or every total overstates — discounted revenue most of all, since a refunded purchase gives its code back to the pool as well as its money back to the member.

### 16. Study leave

**A third Leave Type, `study`, deliberately the least exceptional of the three.** Everything the two existing types share, it shares; it differs in exactly two places — the days it gets, and that it never carries — and both fall out of machinery that already exists.

**The days are a third Assigned figure, not a constant.** `instructors` gains `study_leave_days`, integer, not null, **default 7**, validated 0–365 like its two neighbours. The default backfills every existing row — study leave is for everyone, not something an admin grants per person. A studio-wide constant looked smaller and is not: the pool builder reads Assigned straight off the instructor row for every type in the type list, and the remaining-adjustment check measures its ceiling from Assigned plus Carried; a constant means a branch in both places, in code that is uniform over the types today.

The Pool, its materialisation, its lazy open on first read and its per-instructor row lock are all untouched — study is one more row in the triple, and the carried-days helper already returns zero for anything that is not annual, so use-it-or-lose-it costs nothing.

*A consequence worth naming*: an admin's Remaining adjustment is bounded by Assigned plus Carried, so with Assigned at 7 and no carry, **7 is a hard ceiling for the live year**. A longer course needs that instructor's Assigned study days raised first, which then applies from the next Leave Year — exactly how annual behaves.

**It must start after today. There is no minimum notice.** The existing "annual must start after today" branch widens to "not medical". A minimum-notice rule was rejected: it is a new refusal code, a new message, a new test and a number nobody can defend, to buy a rule the pending queue already enforces — an admin who thinks a request came too late rejects it, with a reason. The medical backdate window stays medical-only and keeps its name.

**Half days are permitted, unchanged.** A study request can be a morning or afternoon half on a single date, at 0.5 days, on the 13:00 boundary. Refusing was the option that cost more code: day counting, leave windows and start-coverage never look at the Leave Type, so permitting costs zero lines and refusing costs a code, a message, a test and a branch in the instructor form. A morning exam is a real shape.

**The medical certificate becomes a Supporting Document, and the naming is renamed with it.** The rule becomes: a Supporting Document may be attached to a **medical or a study** request, and never to an **annual** one — so the existing refusal inverts, and its code and message follow the new name. The rename is not cosmetic and not optional: a column called `medical_cert_key` holding course confirmations reads as a bug to every future reader, and the glossary is binding here. It covers the column, the refusal codes, the type and size constants, the key helper, the storage key prefix, the upload and signed-URL routes, and the portal copy — one column rename plus a find-replace.

**Objects already in the bucket are not moved.** The key is stored per request rather than recomputed, so old rows keep their existing paths and resolve exactly as before. Only new uploads take the new prefix.

The file rules do not change: JPG, PNG or PDF, 5MB, validated server-side before a byte reaches storage, read back through a short-lived signed URL by admins and superadmins only.

**The document is optional, and one request holds one file.** Not required at submission, for study or for medical. Requiring it breaks the shape of the upload — the storage key derives from the request id, so the file can only be posted *after* the row exists, and requiring it would mean either inverting the upload flow for one type or a request that exists half-made until a file lands. The key stays deterministic per request, so a second upload replaces the first. No multi-file model, no versioning.

**The emails are untouched.** The four leave templates interpolate the leave type as a raw string and stay exactly as they are — "Chris requested study leave — 12 Aug", "your study leave on 12 Aug has been approved" all read correctly. No display-label variable, no template edit, no reseed. The portal already formats for the screen and gains one label entry.

**Migration**: add the study-days column with its default (which backfills every row — no separate statement), then rename the certificate column. **The leave pools table is not backfilled** — lazy materialisation writes the study row on the first balance read of the year, carrying zero, the identical number a backfill would write.

**Nothing switches exhaustively on the two existing values.** Every per-type structure is either a `Record` keyed by the type union — which the compiler fails on the moment the union widens — or an iteration over the type list. There is no switch, no default-carrying chain, and no place where an unknown type is silently ignored. **The one exception, and the only silent failure**, is the `z.enum` on the instructor leave route: runtime, not compile-time, and a 400 if missed.

**What did not change**: occupancy (the module never sees the Leave Type), the hard block against the instructor's own teaching schedule, the four ways a request ends, carry-over, and the studio-wide carry-over cap, which stays annual-only in effect.

### 17. Leave Caps

**The rule is a cap the studio sets, not "no two instructors on the same day".** One concept, **Leave Cap**, used twice:

| | Who is counted | The number | What it refuses |
|---|---|---|---|
| **Cover Group** | The instructors an admin ticks | `cover_group_leave_cap`, default 1 | Annual and study requests from a Cover Group member |
| **Study Leave** | Every instructor | `study_leave_cap`, default 1 | Study requests from anyone |

Both live on Global Policy beside the carry-over cap, both set by an admin, **minimum 1** — zero would freeze annual leave studio-wide, which is not what this control is for.

**The Cover Group is one ticked set, not named groups.** `instructors` gains `in_cover_group`, boolean, not null, **default false**, so every existing row backfills to false and **the rule is inert until an admin ticks somebody** — no migration risk, and no studio wakes up to refusals it did not ask for. A table of named groups was rejected: it is a second concept — name it, CRUD it, decide what membership of two groups means — bought for a requirement nobody stated. Deriving the group from the instructor-to-class-type mapping was rejected harder: it makes an invisible rule out of a scheduling table, so an admin editing a class type would silently change who may take leave. The admin panel is a **multi-select** of instructors labelled **Cover Group** — the panel and the glossary say the same word, and a multi-select works on mobile and with a keyboard where drag-and-drop does not.

**What each cap counts is not symmetric.** The **Cover Group cap counts every Leave Type**, medical included — the purpose of the group is cover, and the studio has lost that instructor whatever the reason. This refuses no medical request; it only tells the *next* annual applicant to pick another day. The **Study Leave cap counts study leave only** — the requirement is study-against-study, and counting all leave would make study leave nearly unobtainable, since with a cap of 1 one person's holiday anywhere in the studio would block courses for everyone.

| Request | Refused by |
|---|---|
| Annual, from a Cover Group member | The Cover Group cap |
| Annual, from anyone else | Nothing |
| Study, from a Cover Group member | Both caps — both must clear |
| Study, from anyone else | The Study Leave cap |
| Medical, from anyone | **Nothing, ever.** It still counts toward the Cover Group cap for everybody else |

**The cap is a peak measured in instants, not a count of overlapping people.** The naive reading — count the other instructors whose leave overlaps mine, refuse if that reaches the cap — is one line and it is wrong:

> Cap 2. Alice is away Monday. Cara is away Wednesday. Bob asks for Monday–Wednesday. Two other people overlap his request, so the naive rule refuses him — but at no moment are more than two instructors away. Monday has Alice and Bob. Wednesday has Cara and Bob.

The rule is: over the requested window, find the **peak** number of instructors away at any single instant, count the applicant, and refuse if that peak exceeds the cap. A sweep over the boundary instants of the overlapping leave, clipped to the requested window — a pure function of a list of windows, with no clock and no database. With a cap of 1 the peak and the naive count are identical, which is why this only surfaces once the cap is a number the studio sets.

**Half days are counted exactly and fall out of this for free.** Alice off Tuesday morning and Bob off Tuesday afternoon are never away at the same instant, so with a cap of 1 Bob is approved and the studio keeps cover all day. The existing leave-window helper already produces half-open instant windows and the occupancy comparisons already use the 13:00 boundary. There is no new arithmetic on this side.

**Pending counts**, exactly as it does for the Pool — the occupying-statuses set is reused verbatim, so the first instructor to *submit* holds the day before an admin has looked at it. Approved-only does not remove the refusal, it moves it: both file, both wait, the admin can approve one, and the disappointment arrives later and lands on the admin. Pending-counts is also the trade the Pool already makes, so it is behaviour instructors have already learned. A request later rejected frees the day at that moment; nothing is written back.

**Refused at submission, and the lock must widen.** The refusal sits beside the existing submission check. **It does not work without widening the lock**: submission opens by locking *the applicant's* instructor row, so two different instructors take two different locks and two Cover Group members submitting the same dates concurrently both read a clear calendar and both pass. The fix is in the where clause of a query that already exists — lock every row of the counted set, **ordered by staff user id** so two transactions cannot deadlock. For a Cover Group annual request that is the group's rows; for a study request it is every instructor, which serialises study submissions studio-wide — irrelevant at this scale and cheaper than any correct alternative.

**There is no admin override, and none is needed.** Refusing at submission means the clashing request never exists, so there is nothing at approval time to override, and the decision function re-checks nothing — it stays a pure status transition. **The escape hatch already exists and costs no code**: raise the cap, have the instructor resubmit, lower it back — clunky, deliberate, and audited by the policy change itself. If exceptions turn out routine rather than rare, that is the signal to build a real override, and it is a smaller change to make then than to carry an unused one now. **Raising or lowering a cap is never retroactive**; approved leave stays approved when the cap drops.

**The refusal names the colleagues, never the reason.**

> "Alice and Cara are already on leave on 18 Aug. At most 2 instructors can be away at once."

Naming leaks nothing — the leave calendar already shows every staff member the name, dates and status of every colleague's leave, and redacts only the detail (type, reason, document). The refusal stays on the same side of that line. A vague refusal sends the instructor to an admin to ask who; naming lets the two settle it directly, which is the whole point of the who's-away view.

**A medical request over the cap tells the admins twice.** Medical is never refused, so the studio has to find out another way, in time to arrange cover. **In the submission email** admins already receive: one new variable, empty unless the cap is exceeded — "⚠️ This puts 3 instructors away on 18 Aug, above the cap of 2." One variable, one template line, one reseed. **On the leave calendar**, as a flag **inside the entry's detail object**, which is already null for an instructor viewing a colleague's row — so the redaction is structural and free, and the flag is only ever shown to people who can see the cap it refers to. It is computed from rows the calendar query already fetches, by the same pure peak function. The email is what actually reaches an admin; the calendar only works if someone opens it.

**What did not change**: the Pool and every number drawn from it (a cap refusal happens before anything is written, so it takes no days and returns none), the clash rule against the instructor's own schedule, and the four ways a request ends.

### 18. Glossary and documentation owed

`be/CONTEXT.md` already carries Location, Unlimited Plan, Home Location, Cross-Location Add-On, Covers, Duration, Dormant, Activation, List Price, Promotion, Promo Code, Redemption, Hold, Refund, Void, Untouched, Cover Group and Leave Cap. Two entries are still owed and land with this work:

- **Leave Type** currently reads "Annual or medical" and must widen to the three types.
- **Supporting Document** is new (*avoid*: medical certificate, MC, attachment, proof).

Documentation that is now wrong and must be **replaced, not extended**:

- `backend-architecture.md` §8 describes typed promo codes as deferred and sketches a different model — a used-count on the code row and a valid-from window. Both are wrong. The `promo_codes_enabled` flag note in the same document is stale.
- `fe-client-features.md` and `be-client.md` need the checkout review step, the Location picker, the Add-On, and the four confirmation emails.
- `class-booking-lifecycle.md` needs the Location filter, the activation stamp and the `use_credits` escape.
- `spec-instructor-leave.md` and `spec-instructor-leave-pools.md` need the third type, the Supporting Document rename and the two caps.

---

## Testing Decisions

### What a good test is here

This repo has one testing idiom and it is worth stating before adding to it. Tests are **bare `node:assert` blocks in a sibling `.test.ts`**, run by `npm run check` (`node --test`). There is no framework, no describe/it, no fixtures, no mocking library, and **no database or HTTP in any test**. Each block is scoped with braces, and assertions carry a message saying what the code is supposed to guarantee. Several existing files open with a comment naming the defect the module exists to prevent — that convention is worth keeping.

The consequence is that **a rule is only testable if it is a pure function**. Testing external behaviour rather than implementation means, concretely: the module takes rows and a clock and returns a decision or a refusal; the service around it does the database work and translates refusals into typed errors. A test asserts on the decision, never on how it was reached.

Refusals are **returned, not thrown**, so the pure layer stays pure and the calling service maps them to the project's error types. This is the existing pattern in the credit-movement module and it is the one to follow for every new module below.

### The seams

**Five modules, three of them new.** Two existing seams are extended; the booking, grant and webhook services stay database-only shells that call in.

| Module | New? | Owns |
|---|---|---|
| `services/leave/rules` | existing | Study leave rules, the peak-overlap function, the two Leave Cap checks |
| `services/packages/validity` | existing | Dormant semantics, calendar-month Duration arithmetic, the activation date, Add-On months-remaining and price |
| `services/packages/selection` | **new** | Which package pays for a booking — Location coverage, Add-On coverage, Activated-before-Dormant order, the prospective-expiry test, the `use_credits` escape |
| `services/packages/promo-codes` | **new** | Normalisation, validation against code and scope rows, discount arithmetic, which failure reason applies (replaces the deleted hardcoded module) |
| `services/notifications/purchase-email` | **new** | The composed `contents_line` and `validity_line` per package kind |

Add-On pricing and calendar-month arithmetic ride in the validity module rather than earning a sixth file — it already owns expiry and duration and is already a tested seam. The `Untouched` predicate is a one-line fold over bookings and needs no seam of its own.

**Why `selection` is a new seam rather than testing at a higher one.** The booking service is a single database transaction with no seam at all today, and there is no HTTP or database test harness anywhere in the repo — adding one is a far larger investment than one pure module. Without this extraction, none of the Location, Add-On, activation-ordering or prospective-expiry rules are testable at all.

### Prior art

- **`services/packages/validity.test.ts`** — the closest model for the new package modules: a small row factory, a fixed `NOW`, a narrowing `ok()` helper for results expected to succeed, and blocks that each assert one rule including the refusal cases.
- **`services/packages/promotions.test.ts`** — the model for the promo-code module: a factory building a full inferred Drizzle row from a partial override, with a comment explaining that only a few fields are actually read.
- **`services/leave/rules.test.ts`** — the file the leave work extends directly, 815 lines of the same idiom, already covering day counting, leave years, windows, half days and pool figures.
- **`services/schedule/occupancy.test.ts`** — prior art for instant-window overlap comparisons, which the peak function builds on.

### What each module must cover

**`leave/rules`** — study leave refused a backdate and refused a start of today; study permitted a half day; study carrying zero across a year boundary; a Supporting Document accepted on study, accepted on medical, refused on annual. Then the caps: **the peak is a peak and not a headcount** (the Monday/Wednesday case above is the canonical test); half days on the same date do not collide; medical counts toward the Cover Group cap but is never refused by it; the study cap counts study only; a Cover Group member's study request must clear both caps; a cap of 1 behaves identically to the naive rule.

**`packages/validity`** — a calendar-month Duration clamps a month-end (31 August plus six months is 28 February); a Dormant plan's months remaining is its stored Duration with no arithmetic; a part month rounds up; the Add-On price is months times rate; `computeActive` for a Dormant plan.

**`packages/selection`** — an Unlimited Plan at the class's Location is chosen; one at the other Location is not; one carrying an Add-On is chosen at either; Activated is preferred over Dormant; the soonest-expiring Activated plan wins; a Dormant plan whose Duration would end before the class starts is refused rather than chosen; no covering plan returns `location_not_covered` and does **not** fall through to credits; the same case with `use_credits` set does fall through; a member with only credits is unaffected by any of it.

**`packages/promo-codes`** — normalisation of case and whitespace; percent and absolute discount arithmetic; a discount flooring at zero rather than going negative; each of the five failure reasons returned distinctly, with unknown and archived returning the *same* one; scope matching for an all-products code, an explicit list, and a workshop scoped at workshop rather than tier level; a used-slot count treating a lapsed hold as free and a consumed row as taken and a refunded row as free.

**`notifications/purchase-email`** — the contents line for each of the four package shapes; the validity line for Unlimited carrying the activation sentence; **the validity line for every other kind carrying a date and never mentioning activation** (this is the test that protects the decision); the receipt URL falling back to the account page when there is no receipt.

### Not tested

Database constraints, the webhook's idempotency behaviour, the hold's row-lock serialisation, and the email helper's swallow are all correctness properties of code that touches a database or a network. They have no seam in this repo and this spec does not invent one for them. They are covered by the constraint definitions themselves, by the existing unique indexes, and by manual verification against staging before launch.

---

## Out of Scope

Ruled out during charting. Each returns only as its own effort.

- **The Reports surface, including the Revenue report.** The PRD specifies six reports with a shared filter set and CSV export; none exists, no route is mounted, and there is no reports page. Building the Revenue report drags in the whole surface that hosts it. **What is kept** is the storage half — the frozen columns above. Three conditions for whoever builds it: granularity (monthly total, per-package, exportable row) is deliberately undecided because nobody has evidence for a shape; the **Unattributed bucket is mandatory**, since a Location total that silently omits Credit Bundles is a wrong number rather than a partial one; and revenue counts from the **purchase**, not from Activation, so a Dormant plan's money belongs to the month it was bought.

- **The package expiry reminder.** The lapsing and expired notification jobs are empty stubs on a daily cron, and the reminder template has a seeded row, declared variables and portal preview copy but no sender anywhere. Not one of the four changes. One mandatory condition for whoever builds it: **the "expiry is not null" predicate is required** — a Dormant plan is neither expiring soon nor expired.

- **The admin complimentary-grant route.** Currently a `501` stub. Pre-existing unbuilt work, and now that comp grants send no email, nothing in this batch depends on it.

- **A standalone admin revoke** — taking entitlement away without moving money. A Refund is the only reason the studio has to do it.

- **Partial refunds, in any form**, and any pro-rating rule or calculator. Whether to refund a part-used plan is studio policy spoken by a human, not code.

- **Corporate refunds.** Corporate creates no client-package row — the corporate request *is* the entitlement — so there is nothing to void.

- **Recurring or subscription billing for the Add-On.** The studio was explicit: all months are paid in one go, up front. No subscription, no monthly charge, no dunning.

- **Reworking the referral system.** The referral service is a stub that throws. It overlaps conceptually with Promo Codes and is a separate effort.

- **Multi-tenant or multi-studio expansion.** The platform is dedicated to Yoga Sadhana. The Location model should not hardcode two Locations, but supporting other studios is not this effort.

- **An activation deadline.** The studio chose activation-on-first-booking *without* one, so a renewal bought today and first booked in three years is honoured at today's price. Left open knowingly: the purchase timestamp is already stored, so a "must activate within N days" rule is a later query rather than a migration, and nobody has evidence for a number. What this spec asks for instead is **visibility** — Dormant plans legible to staff and members before anyone rules on it.

- **Auto-reversal of activation when the studio cancels the class that activated a plan.** Staff return the plan to Dormant by hand. Add it if it turns out to happen monthly rather than yearly.

- **A staging-to-production data migration.** Production is empty and staging holds the working dataset, so launch is a data question that deployment documentation already calls a separate job.

---

## Further Notes

**Shipping order is free.** There is no business-driven first. Yoga Sadhana is pre-launch and not close to launch, and every urgency driver dissolves against that: a revenue lever needs a campaign and there is nobody to run one at; the leave cap's urgency was "whatever the leave calendar says" and nothing runs through the portal; "the email members notice by its absence" needs members. The strongest ordering argument — that zero Unlimited Plans sold is the cheapest this will ever be to ship — closes on a **sale**, not on a date, and no sale can happen before launch, so the window stays open throughout.

**All four ship before the first member arrives.** That is a completeness requirement, not an ordering one, and it is the only real constraint the studio gave. The pre-launch window is what makes every one of these cheap — the plain `ALTER TABLE`, the semantic change to a null expiry landing on zero rows, the Promo Code tables built with no import — and that is a property of shipping before launch rather than of shipping in any particular order.

**If work runs in parallel, the leave cluster is the clean split.** It touches instructors, leave requests and Global Policy, and no other part of this spec touches any of the three. The other sections all converge on the client-packages table, the Promo Code tables and the checkout page.

**Migration ordering within the batch** is left to ticket decomposition. The constraint that matters: the folded `client_packages_kind_fields` check depends on `location_id`, `duration_months` and the trial validity change all being present, so it lands last of that group rather than being written three times.

**The backfill probe found nothing to backfill.** Both databases were read on 2026-08-16. Production is completely empty. Staging holds 5 accounts, 4 bookings all-time, 1 member active in the last 30 days, and 3 purchased packages from a single run on 2026-07-01. **Zero Unlimited Plans anywhere**, so the Location column is a plain `ALTER TABLE`. **Zero rows with a null expiry**, so activation has no legacy "never expires" row to tell apart from a Dormant one. **No Promo Code has ever been redeemed** — all three purchases paid full list price — so the tables are built clean with no import path.

**Two things observed but not fixed here.** The seed file seeds two email templates whose slugs the template union does not declare, so they are unreachable from the send function — the same class of spec-versus-code gap that left the purchase templates unsent for months. And if the payment provider's own automatic receipt emails are switched on in the dashboard, a paid purchase will produce two emails; ours is the branded one carrying the QR code and the activation sentence, theirs is a bare payment record. Worth a look at go-live rather than a change now.

**The prototype that produced §12** lives on the `prototype/checkout-location-picker` branch, mounted inside the real client layout on the real catalogue fetch. All three variants and both blocked-class treatments are there, and the losing variants stay as the record of what was compared. Throwaway — not to be merged.

**Provenance.** Every decision in this spec traces to a closed ticket: [#4](https://github.com/Blueprint-Agency/booking-system/issues/4) Stripe coupons ruled out · [#5](https://github.com/Blueprint-Agency/booking-system/issues/5) the Promo Code model · [#6](https://github.com/Blueprint-Agency/booking-system/issues/6) Home Location and the booking rule · [#7](https://github.com/Blueprint-Agency/booking-system/issues/7) the Cross-Location Add-On · [#8](https://github.com/Blueprint-Agency/booking-system/issues/8) the checkout review step · [#9](https://github.com/Blueprint-Agency/booking-system/issues/9) study leave · [#10](https://github.com/Blueprint-Agency/booking-system/issues/10) the Leave Cap · [#11](https://github.com/Blueprint-Agency/booking-system/issues/11) first-booking activation · [#12](https://github.com/Blueprint-Agency/booking-system/issues/12) purchase confirmation emails · [#13](https://github.com/Blueprint-Agency/booking-system/issues/13) the backfill probe · [#14](https://github.com/Blueprint-Agency/booking-system/issues/14) refunds · [#15](https://github.com/Blueprint-Agency/booking-system/issues/15) frozen revenue numbers · [#16](https://github.com/Blueprint-Agency/booking-system/issues/16) shipping order.
