# Research — Can Stripe's own coupons carry our promo-code rules?

Ticket: [Blueprint-Agency/booking-system#4](https://github.com/Blueprint-Agency/booking-system/issues/4).
Checked **2026-08-16** against the current Stripe API reference (Clover-era docs, `2025-09-30`+)
and cross-checked against the version we actually run: **`stripe@14.25.0`, pinned
`apiVersion: '2023-10-16'`** (`be/src/lib/stripe.ts:5`). Where the two differ it is called out.

---

## Verdict

**Our own table.** Two of the five rules the studio asked for cannot be expressed in Stripe at
all: there is no per-customer redemption cap on a Coupon or a Promotion Code — none, at any API
version — and `applies_to.products` cannot match our checkout, because every session builds an
*inline* product via `price_data.product_data`, which mints a brand-new `Product` with a
Stripe-generated id that no pre-registered list can contain. Making the Stripe path work means
creating and syncing a real Stripe Product for every class package, PT package and workshop tier,
*and still* keeping a local redemption ledger for the once-per-client cap, because we check out as
a guest and Stripe never learns our `client_id`. That is two sources of truth and an admin panel
that has to write both. A `discount_codes` table plus a `discount_code_redemptions` ledger drops
straight into `be/src/lib/promo-codes.ts`, which already computes the discount and already stamps
`promo_code` and `client_id` into session metadata — the money math in
`be/src/routes/client/purchases.ts:113-124` does not change at all.

---

## Requirement → Stripe capability

| Studio rule | Stripe field | Verdict | Source |
|---|---|---|---|
| Percent **or** absolute discount | `coupon.percent_off` / `coupon.amount_off` + `currency` | **native** — exactly one of the two per coupon | [Create a coupon](https://docs.stripe.com/api/coupons/create) |
| SGD absolute amounts | `amount_off` in cents + `currency=sgd`; `currency_options` for multi-currency | **native** | [Coupon object](https://docs.stripe.com/api/coupons/object) |
| Expiry date | `coupon.redeem_by` and/or `promotion_code.expires_at` | **native** | [Customize expirations](https://docs.stripe.com/payments/checkout/discounts) |
| Maximum number of uses | `coupon.max_redemptions` and/or `promotion_code.max_redemptions` | **native**, but global-only | [Limit redemptions](https://docs.stripe.com/payments/checkout/discounts) |
| **Hard once-per-client cap** | — | **not possible** — no such field exists | [Promotion Code object](https://docs.stripe.com/api/promotion_codes/object) (full attribute list; no per-customer counter) |
| First-purchase-only (adjacent) | `restrictions.first_time_transaction` | **partial** — and the docs contradict themselves for guest sessions | [Create a promotion code](https://docs.stripe.com/api/promotion_codes/create) vs [Checkout `customer_creation`](https://docs.stripe.com/api/checkout/sessions/create) |
| Restrict to certain packages | `coupon.applies_to.products` | **not possible as we check out today** — needs real Stripe Products | [How products and prices work](https://docs.stripe.com/products-prices/how-products-and-prices-work) |
| Minimum spend (not asked, free) | `restrictions.minimum_amount` + `minimum_amount_currency` | **native** | [Set a minimum amount](https://docs.stripe.com/payments/checkout/discounts) |
| Redemption counts on payment success | `times_redeemed` | **undocumented** — see §4 | [Coupon object](https://docs.stripe.com/api/coupons/object) |
| Edit a live code | — | **partial** — coupons are near-immutable | [Update a coupon](https://docs.stripe.com/api/coupons/update) |

---

## 1. Field-by-field coverage

### `percent_off` vs `amount_off`, and SGD

A coupon carries `percent_off` **or** `amount_off` + `currency`, never both: *"A coupon has either
a `percent_off` or an `amount_off` and `currency`"*, and `currency` is *"required if `amount_off`
is passed"* ([Create a coupon](https://docs.stripe.com/api/coupons/create)). `amount_off` is an
integer in the smallest currency unit, so S$20 is `amount_off=2000, currency=sgd` — the same
integer-cents discipline `purchases.ts` already uses. `percent_off` is *"a positive float larger
than 0, and smaller or equal to 100"*, so 12.5% is expressible.

A single coupon can hold different absolute amounts per currency via
[`currency_options`](https://docs.stripe.com/api/coupons/object) — irrelevant for a single-currency
studio, but it is the one coupon field that stays editable after creation (see §3).

### `redeem_by` (expiry) — coupon, promotion code, or both?

Both, with different semantics:

- `coupon.redeem_by` — *"Unix timestamp specifying the last time at which the coupon can be
  redeemed (cannot be set to more than 5 years in the future). After the redeem_by date, the coupon
  can no longer be applied to new customers"*
  ([Create a coupon](https://docs.stripe.com/api/coupons/create)).
- `promotion_code.expires_at` — *"The timestamp at which this promotion code will expire. If the
  coupon has specified a `redeems_by`, then this value cannot be after the coupon's `redeems_by`"*
  ([Create a promotion code](https://docs.stripe.com/api/promotion_codes/create)).

The coupon's date is the ceiling; per-code dates are windows inside it, and *"if
`promotion_code[expires_at]` isn't specified, the coupon's `redeem_by` automatically populates
`expires_at`"* ([Add discounts](https://docs.stripe.com/payments/checkout/discounts)). Expiry is
one-way: *"if a promotion code reaches its `max_redemptions` or `expires_at`, it becomes
permanently inactive. You can't reactivate these promotion codes."* Extending a campaign means
issuing a new code, not editing the old one.

### `max_redemptions` — coupon vs promotion code

- `coupon.max_redemptions` — *"Maximum number of times this coupon can be redeemed, **in total,
  across all customers**, before it is no longer valid"*
  ([Coupon object](https://docs.stripe.com/api/coupons/object), emphasis ours).
- `promotion_code.max_redemptions` — *"A positive integer specifying the number of times the
  promotion code can be redeemed. If the coupon has specified a `max_redemptions`, then this value
  cannot be greater than the coupon's `max_redemptions`"*
  ([Create a promotion code](https://docs.stripe.com/api/promotion_codes/create)).

They nest: the coupon's cap is the pool, each code's cap draws from it. Stripe's own example —
*"you can set `coupon[max_redemptions]: 50` and `promotion_code[max_redemptions]: 20`"*
([Add discounts](https://docs.stripe.com/payments/checkout/discounts)). Both direct coupon
applications and customer code entries count toward the same coupon counter: *"Both actions count
toward the same `max_redemptions` limit on the coupon"*
([Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)).

Crucially, the cap is a **global** counter, not a per-person one. Stripe spells this out:
*"setting `max_redemptions=50` means the coupon can only be applied 50 times total: once each to
50 different customers, **50 times to the same customer**, or any combination until the limit is
reached"* (same page, emphasis ours). One client can burn the entire allocation.

### Per-customer limits — and the hard "once per client" cap

**A per-customer redemption cap does not exist in Stripe.** Not on `coupon`, not on
`promotion_code`, not at any API version. The full attribute list of the
[Promotion Code object](https://docs.stripe.com/api/promotion_codes/object) is `id`, `active`,
`code`, `promotion`/`coupon`, `created`, `customer`, `customer_account`, `expires_at`, `livemode`,
`max_redemptions`, `metadata`, `restrictions`, `times_redeemed` — and `restrictions` contains only
`currency_options`, `first_time_transaction`, `minimum_amount`, `minimum_amount_currency`
([restrictions detail](https://docs.stripe.com/api/promotion_codes/create)). There is no
`max_redemptions_per_customer` and no per-customer counter to read. Confirmed against our pinned
version by reading the generated typings in `be/node_modules/stripe/types/PromotionCodes.d.ts` —
identical field set.

The two things Stripe *does* offer are both worse fits:

- `promotion_code.customer` — *"The customer who can use this promotion code. If not set, all
  customers can use the promotion code."* This is a **whitelist of one**, not a cap. To emulate
  "once per client" you would mint one promotion code per client per campaign, each with
  `max_redemptions: 1` — for ~N clients that is N API objects per campaign, all needing to be
  created, listed, matched at checkout and archived. It also requires a real Stripe `Customer` id
  per client, which we do not create (we pass `customer_email` with the default
  `customer_creation: if_required`, so payment-mode sessions produce
  [guest customers](https://docs.stripe.com/payments/checkout/guest-customers), which are
  *"a read-only grouping for completed transactions"* grouped **by card number**, not by our
  client id).
- `restrictions.first_time_transaction` — *"A Boolean indicating if the Promotion Code should only
  be redeemed for Customers without any successful payments or invoices."* This is "new customers
  only", which is a different rule from "once per client" and disqualifies every returning member.
  It is also stricter than it reads: it *"prevents customers from using the coupon if they:
  **Initiated a PaymentIntent, even if the payment never completed**"*
  ([Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)) — one
  abandoned checkout and the client is permanently ineligible.

**Doc contradiction, unresolved.** On guest sessions the two Stripe pages disagree outright:

- [Checkout Sessions API, `customer_creation`](https://docs.stripe.com/api/checkout/sessions/create):
  *"Sessions that don't create Customers instead are grouped by guest customers in the Dashboard.
  Promotion codes limited to first time customers **will return invalid** for these Sessions."*
- [Add discounts guide](https://docs.stripe.com/payments/checkout/discounts): *"Sessions that
  don't create a customer create a guest customer in the Dashboard instead. Promotion codes
  limited to first-time customers **are still accepted** for these Sessions."*

One of these is stale. Either way it does not rescue the requirement, but it is a live landmine
for anyone planning around `first_time_transaction`.

### `restrictions.minimum_amount`

*"Minimum amount required to redeem this Promotion Code into a Coupon (e.g., a purchase must be
$100 or more to work)"*, with `minimum_amount_currency` as the *"three-letter ISO code for
minimum_amount"* ([Create a promotion code](https://docs.stripe.com/api/promotion_codes/create)).
Native and works in payment mode. Not something the studio asked for; free if we went Stripe-native.

### `applies_to.products`

*"An array of Product IDs that this Coupon will apply to"*
([Create a coupon](https://docs.stripe.com/api/coupons/create)). It lives on the **coupon**, and
codes inherit it: *"Promotion codes inherit the product restrictions of their parent coupon"*
([Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)). If nothing
in the purchase matches, no discount is applied — Stripe's stated behaviour is silent no-op, not
an error: *"If you configure a coupon to apply to specific products and a subscription doesn't have
any applicable products, no discount is applied."* See §2 — this is the blocker.

### `duration` (`once` / `repeating` / `forever`)

Irrelevant to us. Stripe says so directly: *"Some coupon object parameters, like `duration`, only
apply to subscriptions"* ([Add discounts](https://docs.stripe.com/payments/checkout/discounts)),
and every enum value is defined in terms of *"charges from a subscription with this coupon
applied"* ([Coupon object](https://docs.stripe.com/api/coupons/object)). We run `mode: 'payment'`
only. Pass `duration: 'once'` (the default) and ignore it.

---

## 2. THE BLOCKER — `applies_to.products` vs our inline `price_data`

**It cannot work as our checkout is written today.** Not "probably not" — the ids can never match.

Our sessions build the line item inline (`be/src/routes/client/purchases.ts:126-141` for packages,
`:201-216` for workshops):

```ts
price_data: {
  currency: 'sgd',
  unit_amount: totalCents,
  product_data: { name: packageName, description: '...' },
},
```

No `price`, no `price_data.product`. Stripe's API reference is explicit about what that does:

- `line_items.price_data` — *"Data used to generate a new **Price** object inline"*
- `line_items.price_data.product_data` — *"Data used to generate a new **Product** object inline"*
  ([Create a Checkout Session, line_items](https://docs.stripe.com/api/checkout/sessions/create))

And the products guide confirms these are real, freshly-created objects, not a reference to
anything we registered:

> *"This method generates `Price` and `Product` objects that are relevant for the specific Checkout
> Session, Payment Link, or Subscription. While the `Price` objects are temporary and not visible
> in the Dashboard, the associated `Product` objects aren't always temporary. For example, `Price`
> objects created with `price_data` don't appear in product searches or lists in the Dashboard."*
> — [How products and prices work](https://docs.stripe.com/products-prices/how-products-and-prices-work)

The product id is generated by Stripe at session-creation time and is unknown to us beforehand — so
it can never appear in a coupon's `applies_to.products` array, which has to be populated when the
coupon is created. Combine that with the documented no-match behaviour (*"no discount is applied"*)
and a product-scoped coupon applied to our sessions discounts **nothing, silently**. The customer
enters a valid code, Checkout accepts the code, the total does not move.

Two things this does *not* break, both confirmed by primary sources:

- **`allow_promotion_codes` works fine with dynamic line items.** Stripe's own example for enabling
  the code box is a `price_data` + `product_data` session with no pre-registered Price at all
  ([Add discounts](https://docs.stripe.com/payments/checkout/discounts), and again in
  [No-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)). Unrestricted
  Stripe codes would work against our checkout today. (We never set the flag, so no Stripe code is
  reachable right now.)
- **There is an escape hatch short of pre-creating Prices.** `line_items.price_data.product` — *"The
  ID of the Product that this Price will belong to. One of `product` or `product_data` is
  required"* — lets us keep the dynamic `unit_amount` (essential: our prices move with promotions
  and early-bird tiers) while pointing at a **real, pre-created Stripe Product**. So the sync
  burden is Products only, never Prices.

That burden is still real: one Stripe Product per class package, per PT package and per workshop
tier, created on catalogue insert, name-synced on rename, archived on soft-delete, with the
`prod_…` id stored on our rows and a repair path for when the two drift (a package created while
Stripe is down has no product id and its checkout breaks). Workshop tiers make it worse — every
new workshop spawns N tier products, so the catalogue grows without bound.

**Not ambiguous.** Stripe never publishes a sentence of the form "`applies_to` does not work with
`price_data`", so the claim is assembled from two documented facts rather than quoted from one
page. If you want it nailed shut, the cheapest experiment is in §"Open / unsettled".

---

## 3. Dashboard visibility and post-creation edits

**Visible and manageable — yes.** Coupons and promotion codes are the same objects whether created
by API or Dashboard; Stripe documents both paths side by side for create, set-eligible-products,
deactivate and delete ([Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons),
Dashboard tabs under **Products → Coupons**). Admin staff could manage codes directly in Stripe
without our panel — the one genuine advantage of the Stripe-native path.

**Editable after creation — almost nothing.** The API reference is blunt: *"Updates the metadata of
a coupon. Other coupon details (currency, duration, amount_off) are, by design, not editable"*
([Update a coupon](https://docs.stripe.com/api/coupons/update)). The only accepted update params
are `currency_options`, `metadata` and `name`. The Dashboard says the same: *"The name is the only
setting you can edit after you create the coupon."* So `percent_off`, `amount_off`,
`max_redemptions`, `redeem_by` and `applies_to` are **frozen at creation**.

Promotion codes are barely better: *"Updates the specified promotion code by setting the values of
the parameters passed. **Most fields are, by design, not editable**"*
([Update a promotion code](https://docs.stripe.com/api/promotion_codes/update)) — accepted params
are `active`, `metadata`, `restrictions`. `code`, `expires_at`, `max_redemptions` and `customer`
are frozen.

Practical consequence for the admin panel: "edit this code's discount / expiry / usage cap" is not
implementable against Stripe. Every change is delete-and-recreate, and *"if the underlying coupon
for a promotion code becomes invalid, all of its promotion codes become permanently inactive …
These promotion codes can't be reactivated."* Deletion is also not retroactive — *"Deleting a
coupon prevents it from being applied to future transactions or customers, but it doesn't remove
the discount from any subscription or invoice that already has it."*

Archiving is the only clean lever: `promotion_code.active = false`, then re-create a fresh code
with the same string (Stripe explicitly allows *"create a promotion code with `code: NEWUSER`,
inactivate it by passing `active: false`, and then create a new promotion code with
`code: NEWUSER`"*). Note the counters do **not** carry over — a re-issued code starts at
`times_redeemed: 0`, so a "max 100 uses" cap silently resets on every edit.

---

## 4. Redemption counting on abandoned checkouts — **undocumented**

Our locked rule is that a redemption counts on payment success. **Stripe does not document when
`times_redeemed` increments for a Checkout Session, in either direction.** What the primary sources
do say:

- `coupon.times_redeemed` — *"Number of times this coupon has been applied to a customer"*;
  `promotion_code.times_redeemed` — *"Number of times this promotion code has been used"*
  ([Coupon object](https://docs.stripe.com/api/coupons/object),
  [Promotion Code object](https://docs.stripe.com/api/promotion_codes/object)). "Applied" and
  "used" are never defined against session lifecycle.
- *"When a customer redeems a coupon, Stripe creates a `Discount` object to track that redemption"*
  ([Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)).
- The [Discount object](https://docs.stripe.com/api/discounts/object) carries
  `checkout_session` — *"The Checkout session that this coupon is applied to, if it is applied to a
  particular session in payment mode"* — which proves a Discount is bound to an individual session,
  but not at which moment it is created or whether it survives expiry.
- Session expiry is documented only in terms of the session: *"A Checkout Session becomes abandoned
  when it reaches its `expires_at` timestamp and the customer hasn't completed checking out. When
  this occurs, the session is no longer accessible and Stripe fires the `checkout.session.expired`
  webhook"*, and the recovery URL *"creates a new Checkout Session that's a copy of the original
  expired session"* ([Recover abandoned carts](https://docs.stripe.com/payments/checkout/abandoned-carts)).
  Nothing about releasing a redemption slot. Sessions default to a 24-hour `expires_at`, settable
  from 30 minutes to 24 hours ([Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create)).

So: if Stripe holds a slot at code-entry time and does not release it on expiry, a `max_redemptions`
cap can be exhausted by browsers that never pay — and we would have no way to detect or repair it,
because `times_redeemed` is read-only. If Stripe only counts on completion, its behaviour matches
our rule. **The docs do not settle it.** Cheapest test in the last section. Our own table has no
such ambiguity: we already write the redemption on `checkout.session.completed` in
`be/src/services/billing/webhook-handler.ts`, and `session.metadata` already carries both
`promo_code` and `client_id` (`purchases.ts:142-151`).

---

## 5. Stacking on our already-discounted `unit_amount`

Behaves as expected, with one hard constraint.

Our checkout resolves the automatic DB promotion first and hands Stripe the *net* price
(`purchases.ts:113-124` → `unit_amount: totalCents`). Stripe never sees the list price. Its
discount then applies to the session subtotal, which is *"Total of all items **before** discounts
or taxes are applied"* — i.e. our already-discounted figure — producing `amount_total`, *"Total of
all items **after** discounts and taxes are applied"*
([Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object)). So `percent_off`
takes its cut of the discounted amount and `amount_off` is subtracted from it, which is exactly the
stacking order the locked decision wants.

**Overshoot floors at zero, it does not go negative.** Stripe treats an oversized discount as a
supported way to reach a free order: *"You can also create a free Checkout Session by applying a
coupon for an amount equal to or **exceeding** the Checkout Session total"* and *"Customers can
also check out for free if they apply a promotion code for an amount equal to or exceeding the
Checkout Session total"* ([No-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)).
Two operational catches if we ever allow a code to zero out an order: no PaymentIntent is created
(*"Completed Checkout Sessions that are free won't have an associated PaymentIntent"* — fulfil on
`checkout.session.completed`, which `webhook-handler.ts` already does), and no-cost orders force
customer creation (*"If the `customer` property isn't set, the Checkout Session automatically
creates a new Customer object. This means guest customers aren't supported"*).

**One discount per session, full stop.** *"Checkout Sessions currently support up to one coupon or
promotion code"* ([Add discounts](https://docs.stripe.com/payments/checkout/discounts)); the
`discounts` array is *"The coupon or promotion code to apply to this Session. Currently, only up to
one may be specified"* ([Checkout Session create](https://docs.stripe.com/api/checkout/sessions/create)).
Stripe's 20-discount stacking documentation is subscriptions-only. So even the *Stripe-native*
route could never stack a Stripe-side automatic promotion with a Stripe-side customer code — the
automatic half has to stay in our `unit_amount` regardless, which is what we already do.

---

## What each option costs us

### A. Stripe-native

- **Build:** admin CRUD proxying `POST /v1/coupons` + `POST /v1/promotion_codes`; a Stripe Product
  per class package / PT package / workshop tier, created and archived alongside our catalogue
  rows, with `stripe_product_id` columns and a reconcile job; switch every line item from
  `product_data` to `price_data.product`; set `allow_promotion_codes: true`; drop
  `validate-promo` (Stripe validates in its own UI, so the FE loses inline feedback).
- **Ongoing:** the Product sync is forever. Rename a package → update the Product. Soft-delete →
  archive it. Add a workshop with 3 tiers → 3 more Products. Stripe outage during catalogue writes
  → orphaned rows whose checkout fails until repaired.
- **What we lose:** once-per-client (impossible), editing a live code (impossible), a promo
  audit trail keyed to our `client_id`, and control over when a redemption counts (§4).
- **What we gain:** staff can manage codes directly in the Stripe Dashboard.

### B. Our own table (recommended)

- **Build:** two tables — `discount_codes` (code, kind `percent|amount`, value, `expires_at`,
  `max_redemptions`, `per_client_limit`, nullable scope rows for eligible packages, `active`) and
  `discount_code_redemptions` (code id, client id, session id, unique on (code, client) when the
  per-client limit is 1). Replace the `PROMO_CODES` literal in `be/src/lib/promo-codes.ts` with a
  lookup; the callers in `purchases.ts` keep their shape. Record the redemption in
  `webhook-handler.ts` on `checkout.session.completed` from the metadata already being written.
  Admin CRUD is an ordinary table screen.
- **Ongoing:** none. No external objects to keep in step.
- **What we lose:** codes are not visible in the Stripe Dashboard — reconciliation is via session
  metadata, which already records `promo_code` and `promo_discount_sgd`.
- **Note:** today an invalid or exhausted code is silently ignored (`if (promo.valid)` in
  `purchases.ts:117` and `:193`) and the client is charged full price with no error. With usage
  caps that becomes a support ticket. The checkout endpoints should reject a bad code rather than
  quietly dropping it.

### C. Hybrid (Stripe holds money rules, we hold the ledger)

Worst of both. Still needs the full Product-sync burden for package scoping, still needs our
redemption ledger for once-per-client, and adds a two-phase write to admin CRUD (create in Stripe,
mirror locally, reconcile when the second write fails). Only worth revisiting if the studio starts
selling subscriptions, where `duration`, proration and stacked discounts become real and Stripe's
billing machinery earns its keep.

---

## Open / unsettled

| Question | Cheapest test |
|---|---|
| **Does `applies_to.products` truly no-op against an inline `product_data` line item?** Assembled from two documented facts, never stated in one sentence. | Test mode, ~5 minutes: create a coupon with `applies_to[products][]=prod_<any real product>`, create a session with our exact `price_data`+`product_data` shape and `discounts[0][coupon]=<id>`, then read `amount_total` and `total_details.amount_discount`. Zero discount confirms it. Repeat with `price_data[product]=prod_<that product>` to confirm the escape hatch works. |
| **When does `times_redeemed` increment for a Checkout Session?** (§4) | Test mode: coupon with `max_redemptions: 1`, a promotion code on it, `allow_promotion_codes: true`; open the session, enter the code, **do not pay**. Read `times_redeemed` immediately, then set `expires_at` to +30 min (the documented minimum) and read it again after `checkout.session.expired` fires. Same run answers both "held at entry?" and "released on expiry?". |
| **Are `allow_promotion_codes: true` and a pre-applied `discounts[]` mutually exclusive on one session?** Implied by *"up to one coupon or promotion code"*, never stated as a rule. | One API call with both set — it either 400s or it doesn't. Only matters if we ever move the automatic promotion into Stripe, which §5 argues against. |
| **The guest-customer / `first_time_transaction` contradiction** between the API reference and the discounts guide. | Not worth testing — the requirement is once-per-client, not first-time-only, and neither reading satisfies it. Documented here so nobody plans around the optimistic page. |

## API-version notes

Every field cited exists on our pinned `2023-10-16` — verified against the generated typings
shipped with `stripe@14.25.0` (`be/node_modules/stripe/types/Coupons.d.ts`,
`PromotionCodes.d.ts`): `applies_to.products`, `currency_options`, `max_redemptions`, `redeem_by`,
`expires_at`, and `restrictions.{first_time_transaction,minimum_amount,minimum_amount_currency,currency_options}`
are all present, and no per-customer cap exists there either. Two version differences to know
about, neither of which changes any conclusion:

- On `2025-09-30`+ a promotion code references its coupon through a polymorphic
  `promotion: { type: 'coupon', coupon: … }` object; on our pin it is the flat `coupon` field, and
  the create param is `coupon=…`, not `promotion[type]=coupon`
  ([changelog](https://docs.stripe.com/changelog/clover/2025-09-30/polymorphic-coupon)). Current
  doc examples show the new shape.
- `2025-03-31` removed the singular `coupon`/`promotion_code` params on Subscription-family
  endpoints in favour of the `discounts` array
  ([changelog](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-singular-coupon-promotion-code)).
  Payment-mode Checkout already uses `discounts[]`, so we are unaffected.

The SDK also carries a warning worth remembering if we ever drop Checkout: *"Coupons do not work
with conventional one-off charges or payment intents"* (`Coupons.d.ts`). Stripe discounts only
exist inside Checkout/Invoices/Subscriptions.

---

## Sources

All checked 2026-08-16.

- [The Coupon object](https://docs.stripe.com/api/coupons/object)
- [Create a coupon](https://docs.stripe.com/api/coupons/create)
- [Update a coupon](https://docs.stripe.com/api/coupons/update)
- [The Promotion Code object](https://docs.stripe.com/api/promotion_codes/object)
- [Create a promotion code](https://docs.stripe.com/api/promotion_codes/create)
- [Update a promotion code](https://docs.stripe.com/api/promotion_codes/update)
- [The Discount object](https://docs.stripe.com/api/discounts/object)
- [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [The Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object)
- [Add discounts (Checkout, hosted page)](https://docs.stripe.com/payments/checkout/discounts)
- [Coupons and promotion codes (Billing)](https://docs.stripe.com/billing/subscriptions/coupons)
- [No-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)
- [Recover abandoned carts](https://docs.stripe.com/payments/checkout/abandoned-carts)
- [Guest customers](https://docs.stripe.com/payments/checkout/guest-customers)
- [How products and prices work](https://docs.stripe.com/products-prices/how-products-and-prices-work)
- [Changelog — polymorphic coupon reference (2025-09-30)](https://docs.stripe.com/changelog/clover/2025-09-30/polymorphic-coupon)
- [Changelog — singular coupon/promotion_code params removed (2025-03-31)](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-singular-coupon-promotion-code)

Local files read: `be/src/lib/stripe.ts`, `be/src/lib/promo-codes.ts`,
`be/src/routes/client/purchases.ts`, `be/package.json`,
`be/node_modules/stripe/types/{Coupons,PromotionCodes}.d.ts`.
