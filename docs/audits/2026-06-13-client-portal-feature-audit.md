# Client + Portal Feature Audit — 2026-06-13

Feature-by-feature audit of fe-client, fe-portal, and be across: class booking, PT
sessions, package/credit lifecycle, and **Stripe payment (all payable items)**.
Findings below were produced by parallel domain audits and then **re-verified against
the current working tree** (agents occasionally matched stale indexed content — those
false positives are listed at the bottom).

Severity: **P0** = correctness/money/data-loss, **P1** = user-facing bug/gap, **P2** =
hygiene/stale. "✔ verified" = I read the current file myself.

---

## A. Decisions needed before fixing (product/scope)

These change *what* the correct fix is — not just how to implement it.

1. **GST model — is the catalogue `price_sgd` GST-inclusive or exclusive?** ✔ verified
   `be/src/routes/client/purchases.ts:122,197` compute `totalCents = round(discountedBaseCents * 1.09)`
   and the Stripe line-item description says *"includes 9% GST"*. If catalogue prices are
   already GST-inclusive (typical SG retail), every customer is charged **9% over the
   listed price**, and the FE checkout total (`fe-client/.../checkout/page.tsx:243`) double-applies it too.
   - If inclusive → drop `* 1.09` on the charge; show GST as a display-only split.
   - If exclusive → math is correct; keep, but make the catalogue UI say "+GST".

2. **Stripe refunds — implement now, or genuinely deferred?** ✔ verified
   `be/src/services/billing/refunds.ts:9` `issueStripeRefund` → `throw 'not implemented'`.
   `be/src/services/workshops/cancel.ts:11-29` (the wired path) only flips `lifecycle='cancelled'`
   — **no money returned to paying workshop customers**, yet `refund-outcome.ts` labels admin
   workshop cancels `'stripe_refunded'`. Code comments say "deferred to next slice"; the project
   rule says refunds are fully automated. Decision: build the Stripe refund fan-out in this pass, or leave deferred.

3. **Corporate — paid via Stripe or free request/quote?** ✔ verified
   `purchases.ts` checkout schema is `enum(['class','pt'])` + workshop only — **no corporate branch**;
   `fe-client/.../catalog.ts` posts corporate as a free request. But `stripePaymentKind` enum has
   `corporate_package`, `corporate-packages.ts` carries a `price_sgd`, and CLAUDE.md lists corporate as a
   Stripe item. Either remove the paid framing (enum/price/docs) or build a corporate checkout + webhook branch.

4. **Instructor pay — in-app or out-of-app?** ✔ verified
   Memory says "instructor pay out-of-app (teaching log only)", but a full payroll surface now exists
   (`be/src/routes/portal/{admin,instructor}/payroll.ts`, `services/payroll/list.ts`,
   `pt_sessions.instructor_pay_sgd`, written at `services/pt-sessions/schedule.ts:153`). The memory is
   likely stale (git: "payroll system"). Confirm intent; update memory or strip pay tracking.

---

## B. Confirmed bugs — fixable without a product decision

### Money display
- **P1 ✔ `formatSgd` rounds away cents** — `fe-client/src/lib/utils.ts:22` `maximumFractionDigits: 0`.
  `S$30.50` shows as `S$31` on every catalogue card (packages, per-session, workshop "From",
  workshop tiers), while checkout charges the true amount. Fix: mirror `formatCurrency` (show cents when present).
- **P2 per-session price double-rounds** — `fe-client/.../packages/page.tsx:851` `Math.round(eff/num)` then `formatSgd`.

### Package / credit lifecycle
- **P1 ✔ `setPackageExpiry` never recomputes `active`** — `be/src/services/packages/adjust.ts:134-137`.
  Extending an *expired* package leaves `active=false` so `bookClass` (`book.ts` `eq(active,true)`) keeps
  excluding it; shortening to the past leaves `active=true` until the nightly cron. Fix: recompute `active`
  (via `computeActive` in `services/packages/validity.ts`) in the same update.
- **P2 ✔ `adjustBalance`/`setBalance` don't recompute `active`** — `adjust.ts:57-60`. Adding credits to an
  exhausted bundle won't reactivate it. Same fix.
- **P2 promo codes hardcoded & unlimited-use** — `be/src/lib/promo-codes.ts` (`SADHANA20`/`FRIEND10`),
  no redemption ledger/expiry/per-user cap. Documented as v1 intentional; flag only.

### PT sessions
- **P1 instructor cancel has no ownership guard + is attributed as `admin`** —
  `be/src/routes/portal/instructor/pt-requests.ts:100` passes `source:'admin'`, so any instructor can
  cancel any PT request and it always full-refunds + never counts to the client cap, indistinguishable
  from a real admin. Fix: add `source:'instructor'`, enforce `ptSessions.instructorId === self`.
- **P1 PT request never reaches `attended`** — no writer sets `pt_requests.status='attended'` (corporate
  does, at `corporate/requests.ts:319`). Client "Past" tab (`account/private-sessions/page.tsx:40`) and
  admin "attended" filter (`admin/pt-requests/page.tsx:64`) are permanently empty. Fix: flip on final
  roster check-in or a completion sweep; or drop the tab/filter.
- **P1 client within-window cancel of a *scheduled* PT is hard-rejected (422) but FE copy implies
  forfeit-and-cancel** — `pt-sessions/cancel.ts:158-160` vs `account/private-sessions/page.tsx:178,213`.
  Align FE/BE: either allow forfeit-cancel or disable the button with an explanation.
- **P2 schedule conflict checks run outside the txn (TOCTOU)** — `pt-sessions/schedule.ts:125-142`.
- **P2 stale admin copy** — `fe-portal/.../admin/private-sessions/page.tsx:196` claims PT is "via instructor
  availability"; the real model is request-driven. Reword.
- **P2 mock dialog import** — `fe-portal/src/components/pt-requests/schedule-from-request-dialog.tsx` imports
  `{instructors,locations,rooms} from "@/data"`. Verify the admin schedule path doesn't render mock data.

### Class booking / check-in
- **P1 no-show cannot be marked from the admin roster UI** — `fe-portal/.../admin/schedule/[type]/[id]/page.tsx:262-285`
  only toggles attended; `POST /portal/admin/bookings/:id/no-show` exists but is unused. Add the action.
- **P1 `/admin/check-in` front-desk page is pure mock** — `fe-portal/.../admin/check-in/page.tsx` mutates local
  seed state, never calls `/portal/admin/check-in/manual`. Wire to BE.
- **P1 QR/code scan check-in is 501** — `be/.../portal/admin/check-in.ts:7-8` (`/scan`), `instructor/check-in.ts:4-5`.
  Manual tick is the only working method.
- **P2 ✔ `markNoShow` has no time guard** — `be/src/services/bookings/no-show.ts` checks only `state='confirmed'`;
  an admin can no-show a future class and forfeit the credit. `markAttendance` correctly requires `now>=startsAt`.
- **P2 `flipNoShows` cron is unlocked + ignores `lifecycle`** — `bookings/check-in.ts:77-94` (runs every minute).
- **P2 booking has no `(client_id,class_id)` partial unique index** — race-safe today only via class-row lock; add as defence.
- **P2 QR/code generation has no collision retry** — `bookings/qr.ts:10-18`.

### Cancellation policy drift
- **P1 class window hardcoded 24h in FE but admin-configurable in BE** — `fe-client/src/data/policy.ts:4`
  vs `policy/evaluate-cancellation.ts:51`. Admin edits silently desync FE gating/copy. Fix: expose policy via API.
- **P1 ✔ class within-window cancel is *hard-blocked* (422) but spec says cancel-always-allowed + forfeit** —
  `bookings/cancel.ts:106-110` throws `cancellation_window_passed`, making the `'forfeited'`/`'late'` branches
  in `evaluate-cancellation.ts` dead for clients. Reconcile code ↔ spec.
- **P1 waiver copy says 12h, app uses 24h** — `fe-client/.../waiver/page.tsx` section 4. Fix copy.

### Stripe webhook (✔ verified `webhook-handler.ts`)
- **P1 PI fallback to `session.id`** — `webhook-handler.ts:24-26`. If `payment_intent` isn't yet a string it
  stores the *session* id; a later `charge.refunded` carries the real PI and the refund UPDATE matches nothing.
  Fix: don't fall back; expand/await the PI.
- **P1 `charge.refunded` treats every refund as full + no double-refund/partial handling** — `:113-122` sets
  `status='refunded'` unconditionally. Compare `amount_refunded` vs captured.
- **P1 missing events: `async_payment_succeeded/failed`, `checkout.session.expired`, `charge.dispute.created`** —
  async-payment methods never fulfill; stale `pending` rows never expire.
- **P2 event-level idempotency is read-then-act on `paymentIntentId`** — `:36-40,80-86`. Backed by package
  partial-unique index so double-grant is prevented in practice; harden with a `processed_events` table + txn.
- **P2 no reconciliation if webhook never arrives** — only `sync-session` (requires user to return). Add a sweep job.
- **NOTE (downgraded): "webhook trusts client-supplied amount" is a false alarm** — `amount_sgd` metadata is
  set *server-side* in `purchases.ts:148`; the client cannot tamper with Stripe session metadata. Still, deriving
  the recorded amount from `session.amount_total` is cleaner.

### Workshop checkout UX
- **P1 FE recomputes early-bird independently of BE** — `fe-client/src/lib/workshops.ts:205-233` ignores
  `early_bird_quota`; can show a price the BE won't charge. Display server `effective_price_sgd` only.
- **P1 workshop detail ignores `?cancelled=1`** — BE sets it (`purchases.ts:227`) but `workshops/[id]/page.tsx`
  never reads it; no "payment cancelled" feedback (the package flow handles it). Add the banner.
- **P2 no sold-out / "spots left" UI on workshop list/detail** — full tier still shows an active Pay button.

### Gaps the FE relies on
- **P1 booking QR PNG is 501** — `client/bookings.ts:40`. (FE renders QR client-side from `qr_token`, so this
  stub is actually **dead** — remove it unless a server PNG is needed for email.)
- **P1 ✔ client waiver page never persists** — `fe-client/.../waiver/page.tsx` uses `sessionStorage`, never POSTs;
  `POST /me/waiver/sign` is 501. Implement or descope.
- **P1 invoices/receipts 501 + no account UI** — `client/invoices.ts:4-5`; `stripePayments.receiptUrl` never populated.
- **P2 fe-portal mock layer (`@/data`) still backs 5 live admin pages** — check-in, inbox, notifications, waiver,
  notification bell badge. (The fe-client mock layer was deleted in 2c0bfca; fe-portal's was not.) Implement BE + wire, then delete.

---

## C. Dead / duplicate code to remove
- **✔ `be/src/services/workshops/refund-fanout.ts`** — duplicate `cancelWorkshop` that just `throw 'not implemented'`;
  the wired one is in `cancel.ts`. Delete (or fold into the real refund work from decision #2).
- **`admin/schedule.ts:241`** — 501 stub "admin-cancel workshop + refund fanout" (real path is `/workshops/:id/cancel`).
- **Stale doc-string "paths"** in fe-portal that look like API calls but are file references.

---

## D. Corrected false-positives (do NOT act on)
- ✗ "Client PT route fully 501-stubbed" — **false**; `be/src/routes/client/pt-sessions.ts` is fully wired (✔ read).
- ✗ "Webhook trusts client-supplied amount" — overstated; metadata is server-set (downgraded above).
- ✗ "Money formatters duplicated across apps is a bug" — by-design per the no-shared-deps decoupling rule.
- Several "501 stub still called by FE" table rows depended on stale index; re-verify any before acting.

---

## E. Resolution — what was fixed in this pass (2026-06-13)

Decisions taken: GST **inclusive**; Stripe refunds **stay deferred** (stop the false labelling);
corporate **stays a free request**; instructor pay **tracked in-app, paid out-of-app, mark-paid is a gap**.

**Fixed (all three projects `tsc --noEmit` clean):**
- GST: dropped `×1.09` on both package + workshop charges (`be/.../purchases.ts`); reframed FE checkout to show GST as an *embedded* portion so the displayed total == the charge (`fe-client/.../checkout/page.tsx`).
- `formatSgd` now preserves cents (`fe-client/src/lib/utils.ts`).
- `setPackageExpiry` + `adjustBalance` recompute the `active` flag via `computeActive` (`be/.../packages/adjust.ts`).
- Instructor PT-cancel: ownership guard (`requireOwnInstructorId`) — instructors can only cancel their own scheduled session, never a pending request (`be/.../pt-sessions/cancel.ts`, `routes/.../instructor/pt-requests.ts`).
- PT request → `attended`: new `completeEndedPtSessions` sweep (every 5 min) so "Past" tabs populate (`be/.../pt-sessions/cancel.ts`, `jobs/index.ts`).
- `markNoShow` start-time guard (class + PT) so admins can't forfeit a credit on a future session (`be/.../bookings/no-show.ts`).
- `charge.refunded` only marks the payment refunded on a FULL refund — manual partial/goodwill dashboard refunds no longer mislabel the whole payment (`be/.../billing/webhook-handler.ts`).
- Deleted dead `be/src/services/workshops/refund-fanout.ts`; documented the unreachable `'stripe_refunded'` branch (`refund-outcome.ts`).
- Copy fixes: waiver 12h→24h + hard-deadline wording (`fe-client/.../waiver`), admin private-sessions request-driven copy (`fe-portal`), account PT cancel copy now matches the BE hard-deadline (`fe-client/.../account/private-sessions`), corporate doc comment (`be/.../corporate/requests.ts`).
- Workshop detail now shows a `?cancelled=1` "payment cancelled" banner (`fe-client/.../workshops/[id]`).

**Deferred / larger follow-ups (documented, not built this pass):**
- **Instructor "mark as paid"** — no `paid_at`/payout-status field or endpoint exists (only amount edit). Needs schema migration (PR review) + service + route + FE.
- Stripe **refund fan-out** for admin workshop-cancel (paid customers keep their charge); surfacing a manual-refund count to admins.
- Webhook: PI-fallback-to-session-id, `async_payment_*` / `checkout.session.expired` / dispute events, event-level idempotency table, reconciliation sweep.
- Front-desk `/admin/check-in` page is still mock; QR/code **scan** check-in 501; admin roster **no-show** action; fe-portal `@/data` mock layer behind 5 admin pages; client **waiver persistence** (501); **invoices/receipts** UI + 501; FE cancellation window hardcoded 24h vs admin-configurable; FE workshop early-bird recompute ignoring quota; promo codes hardcoded (v1).
