# UX & Business-Logic Audit — Yoga Sadhana Booking System

**Date:** 2026-04-19
**Scope:** `fe/` (Next.js client app), HEAD `21e394e` (Phase A redesign)
**Verdict:** 🔴 **Not ship-ready.** 8 P0 findings block core flows; 14 P1 items erode trust; 15 P2 items need polish before beta.

**Companion doc:** `redesign-flow-gap-analysis.md` covers v1.3 → HEAD regressions. This audit is wider — flows, UI, responsiveness, business logic, data integrity — and links back where overlap exists rather than duplicating.

---

## How to read this

Each finding: **severity · file:line · problem → fix.** P0 = broken core flow or policy/legal risk. P1 = significant usability/logic gap. P2 = polish, copy, or data hygiene.

---

## Executive summary by theme

| Theme | P0 | P1 | P2 |
|---|---:|---:|---:|
| Flows & journeys | 4 | 4 | 4 |
| UI / responsive / a11y | 1 | 5 | 3 |
| Business logic | 3 | 5 | 4 |
| **Total** | **8** | **14** | **11** |

---

## Theme A — Flows & journeys

### P0

**A1. Class booking confirmation is missing the pre-confirm step, package picker, and credit summary**
- File: `fe/src/app/(client)/booking/confirmation/page.tsx`
- The page skips straight to the success / QR hero. Users who hold >1 package can't pick which credit to burn; no "Reserve Now" click gate; no live "X credits remaining after booking" summary.
- See `redesign-flow-gap-analysis.md` §"Flow 1" for v1.3 reference implementation.
- Fix: restore the `hasMultiplePackages` radio group reading `MOCK_USER.classPackages[]`, wire a `selectedPackageId` state to the credit summary, gate the success state behind an explicit **Reserve Now** CTA.

**A2. Workshops list lost multi-tier pricing, waitlist CTA, and free-vs-paid copy**
- File: `fe/src/app/(client)/workshops/page.tsx`
- Only "From S$X" shown; no per-tier Purchase buttons; no "Join waitlist" when `waitlistEnabled && isFull`; no distinct "Register" copy for free workshops.
- See `redesign-flow-gap-analysis.md` §"Flow 2".
- Fix: render `workshopPackages[]` as tier pills on the list card and as a selector on the detail page (pass `?package={i}` to `/checkout`); restore waitlist link; branch CTA copy on `price === 0`.

**A3. Account history has no cancel / reschedule action**
- File: `fe/src/app/(client)/account/history/page.tsx:34`, `fe/src/app/(client)/account/page.tsx:33`
- History filters by `status === "cancelled"` for display only; `account/page.tsx` declares `const [cancelled] = useState<string[]>([])` with no setter and no UI. PRD §4.12 requires cancel + reschedule from the account area.
- Fix: add a **Cancel** button per upcoming booking → dialog with policy outcome (refund vs forfeit) + confirmation. Reschedule = redirect to `/classes` with level/location prefilled (PRD §4.12 treats reschedule as cancel + rebook).

**A4. `LocationFilter` wired on classes but missing on workshops**
- Files: `fe/src/app/(client)/classes/page.tsx:244,280` (✅ wired) vs `fe/src/app/(client)/workshops/page.tsx` (component not imported).
- Two-studio product (Breadtalk IHQ / Outram Park) with a per-page filter per project memory. Workshops users can't filter.
- Fix: mirror the classes pattern on workshops — `useState<"all"|locationId>`, `<LocationFilter>` above the grid, filter `workshops` by `locationId`.

### P1

- **A5. Checkout silently defaults to "Bundle of 10" on empty/invalid cart** — `checkout/page.tsx:~80–148`. `hasCart` is computed but the page still populates `orderName/total/confirmUrl` with bundle defaults. → Early return `<EmptyState>` with a link to `/packages` when no valid `package|session` query param resolves.
- **A6. Missing empty states** — zero-credit classes list, empty booking history, no-instructor private-sessions list. → Use existing `components/ui/empty-state.tsx` on each list page's empty branch.
- **A7. `/waiver` is not a gate** — `fe/src/app/(client)/waiver/page.tsx` is a standalone page; nothing checks it before first booking. PRD §4 requires a digital waiver before first class. → Persist a mock `sessionStorage.waiverSigned` after submit and redirect from `/classes` → `/waiver` if missing on first booking.
- **A8. Referral never applied at checkout** — `checkout/page.tsx` lacks a referral input. PRD §4.10 rewards are gated behind referral entry; register form has the field but checkout does not. → Add an optional referral input in checkout Step 1 that subtracts a mock credit from `grandTotal` when valid.

### P2

- **A9. `/pricing` duplicates `/packages`** — two entry points with different data sources. → Make `/pricing` a marketing/FAQ landing and `/packages` the purchase surface; cross-link.
- **A10. Reschedule flow missing** — covered by A3; flagged separately since PRD §4.12 makes it an explicit requirement.
- **A11. Workshop detail CTA copy** — "Reserve your seat" → "Purchase Now" per PRD §4.4. See `redesign-flow-gap-analysis.md` P1 #5.
- **A12. Instructor cards on `/private-sessions` don't show per-location badges** — see `redesign-flow-gap-analysis.md` P2 #10.

---

## Theme B — UI, responsiveness, a11y

### P0

**B1. Touch targets below 44×44 px on primary interactive controls**
- Footer social icons `w-9 h-9` (36 px) — `components/layout/site-footer.tsx`.
- Empty-state CTAs `px-5 py-2.5` (≈40 px tall) — `components/empty-state.tsx`.
- Avatar trigger `w-9 h-9` — `components/layout/client-nav.tsx:109` (acceptable as hover, but it's the *only* path to the account dropdown on desktop and it's keyboard-hostile; see B9).
- Fix: enforce `min-h-[44px] min-w-[44px]` on all interactive leaf elements; bump footer socials to `w-11 h-11`.

### P1

- **B2. Arbitrary `text-[##px]` values across the codebase** — `site-footer.tsx`, card components, `client-nav.tsx` (`text-[10px]`, `text-[12px]`, `text-[14px]`). Bypasses the Tailwind/design-token scale; drift risk on responsive tuning. → Replace with `text-xs / text-sm / text-base / text-lg` and extend `tailwind.config` if intermediate sizes are needed.
- **B3. Section padding scale inconsistent** — `py-16` (`BookingSurface`, `site-footer`) vs `py-20 sm:py-28` (`showcase-grid`, `feature-grid`). → Pick one pair (suggest `py-16 sm:py-24`) and apply across all marketing + booking shells.
- **B4. Duplicate empty-state components** — `components/empty-state.tsx` and `components/ui/empty-state.tsx`. → Pick the shadcn-convention `ui/` version; delete the other; update imports.
- **B5. Heading-weight drift** — `components/booking/section-heading.tsx` uses `font-bold` while `hero.tsx` / `showcase-grid.tsx` use `font-extrabold`. Spec calls for `font-extrabold` (800) on h1/h2. → Normalise to `font-extrabold` on h2 as well.
- **B6. Hard-coded overlay** — `bg-[rgba(31,29,26,0.5)]` in `components/marketing/hero.tsx`. → Use the `--color-overlay` token defined in `globals.css`.

### P2

- **B7. Heading hierarchy jumps** — `classes/page.tsx` and a few others go h1 → h3 with no intervening h2. Audit with a DOM inspector and insert semantic h2s for screen-reader navigation.
- **B8. Focus visibility** — `globals.css` declares a `:focus-visible` outline but some custom button shells (group-hover dropdown trigger in `client-nav.tsx`) don't visibly receive it. Tab through the nav and fix any dead stops.
- **B9. Account-menu keyboard access** — `client-nav.tsx:98–182` opens the dropdown on `group-hover` only. Keyboard users can't open it. → Convert to a click/focus toggle (shadcn `DropdownMenu`) so it works without a mouse.

> **Note:** mobile nav drawer IS implemented (`client-nav.tsx:199–291`, hamburger + collapsible menu) — earlier finding removed after code inspection.

---

## Theme C — Business logic & data

### P0

**C1. Cancellation window is stated four different ways across the app**
- `booking/confirmation/page.tsx:200,204` — "more than 3 hours" / "within 3 hours"
- `pricing/page.tsx:18` — "up to 6 hours before class"
- `waiver/page.tsx:24` — 12 hours (per grep)
- `private-sessions/page.tsx:64` and `/private-sessions/[id]/page.tsx:245` — "within 12 hours"
- `private-sessions/[id]/page.tsx:141` — "within 24 hours forfeit"
- PRD §4.12 defines the policy as tenant-configurable but requires **consistency of surfaced copy**. This is a legal / trust risk.
- Fix: single source of truth in `fe/src/data/policy.ts` (or similar); import everywhere; pick one value per booking type (e.g., 12 h for classes, 24 h for private sessions) and stop.

**C2. Per-booking QR missing on confirmation & upcoming bookings**
- Only a static member QR exists at `account/qr/page.tsx` (format `YS-MEMBER-…`). PRD §4 Account Overview and §4 email-template table both specify **per-session QR code** on bookings.
- Fix: encode `QR-BOOKING-{bookingId}` (or the existing `YS-BOOKING-{sessionId}` convention in the redesign) on `booking/confirmation/page.tsx` and in each upcoming-booking card on `account/page.tsx` and `account/history/page.tsx`.

**C3. Unlimited-package path still shows "1 credit will be used"**
- `booking/confirmation/page.tsx` — the credit summary doesn't branch on `selectedPkg.unlimited`. Users on an Unlimited package see misleading debit copy.
- Fix: if `selectedPkg.unlimited`, hide the picker + credit line and show "Unlimited classes — no credit deducted."

### P1

- **C4. Auth forms have no validation** — `register`, `login`, `forgot-password`, `reset-password`. No `required`, `minLength`, email pattern, or submit-disabled state. PRD §4.1 requires ≥8-char password and verified email before first booking. → Add HTML validation and a `disabled={!emailVerified || !phoneVerified}` guard on the register submit.
- **C5. GST rounds to whole dollars** — `checkout/page.tsx:146`: `Math.round(total * 0.09)`. On an S$300 bundle the tax line becomes S$27.00, which happens to match, but on S$249 items it truncates to S$22 (true: S$22.41). → Use `Math.round(total * 100 * 0.09) / 100` (or store cents as integers).
- **C6. Membership page — wrong CTA** — `account/membership/page.tsx` shows "Manage billing"; design-spec §5.6 / PRD §4 row "Membership" specify a WhatsApp **"Contact Sales Team"** link instead. → Swap the CTA for `https://wa.me/…?text=…cancel%20membership`.
- **C7. Waitlist auto-promotion not represented** — PRD §4 / §4.4 require the system to promote the next waitlist entry on cancel. Frontend mock has no badge or status communicating this. → Add a "Promoted from waitlist" state variant in `account/history` and an email-template stub; flag backend work.
- **C8. Referral code mechanism incomplete** — PRD §4.10 specifies a unique 6-digit alphanumeric code. `account/referral/page.tsx` displays it but nothing validates / applies one at checkout (see A8). → Pair with A8.

### P2

- **C9. Dynamic routes don't 404 on bad IDs** — `classes/[id]`, `workshops/[id]`, `private-sessions/[id]` render blank when the ID doesn't resolve. → `if (!session) return <EmptyState title="Session not found" actionHref="…" />` or call `notFound()` from `next/navigation`.
- **C10. Mock session data all in a narrow window** — sessions cluster around April 2026. No past sessions (breaks history + ratings UI), no sessions >1 month out (breaks long-range planning UX). → Seed 10 % past (Feb–Mar) and extend future (May–Aug 2026) in `fe/src/data/sessions.*`.
- **C11. Bundle validity labels vs PRD** — labels in `packages/page.tsx` list 90/180 days while PRD implies a canonical 6-month validity. → Reconcile in one pass with product.
- **C12. Package-balance surface mismatch risk** — `MOCK_USER.classCredits` vs `MOCK_USER.classPackages[]` vs per-page displays on `/packages`, `/account/packages`, `client-nav` pill, and `booking/confirmation`. Easy to drift. → Centralise a single selector `getCreditSnapshot()` in `fe/src/data/mock-user.ts` and consume everywhere.

---

## Navigation map (client routes)

```
/ (home)
├── /classes ─────────────► /booking/confirmation?type=class&session=…
│                          └── (P0 A1: missing Reserve step)
├── /workshops ───────────► /workshops/[id] ─► /checkout?session=…&type=workshop
│                          (P0 A2: missing tier + waitlist)
├── /private-sessions ────► /private-sessions/[id] ─► /booking/confirmation
├── /packages ────────────► /checkout?package=…
├── /pricing              (P2 A9: overlaps /packages)
├── /checkout             (P1 A5: empty-cart default)
├── /account
│   ├── /history          (P0 A3: no cancel UI)
│   ├── /packages         (C12: balance-surface drift risk)
│   ├── /membership       (P1 C6: wrong CTA)
│   ├── /invoices
│   ├── /profile
│   ├── /qr               (member QR only — see C2)
│   └── /referral         (P1 A8/C8: no checkout integration)
├── /login  /register  /forgot-password  /reset-password  /verify-email
└── /waiver               (P1 A7: not gated)
```

Dead ends: `/checkout` with no params (A5). Overlap: `/pricing` ↔ `/packages` (A9).

---

## Prioritised fix backlog

### Before beta (P0 — 8 items)
A1 class-booking Reserve step · A2 workshop tiers + waitlist · A3 cancel UI · A4 workshops location filter · B1 touch targets · C1 cancellation copy · C2 per-booking QR · C3 unlimited-package path.

### Beta polish (P1 — 14)
A5–A8, B2–B6, B9, C4–C8.

### Post-beta (P2 — 11)
A9–A12, B7–B8, C9–C12.

---

## Verification checklist

- [ ] Walk every flow in DevTools responsive mode at 375 px — confirm B1 touch targets on a real finger.
- [ ] Grep for `3 hours|6 hours|12 hours|24 hours` to confirm C1 is fully swept after fix.
- [ ] Tab-navigate from home to confirmation — confirm B8/B9 focus visibility and account dropdown.
- [ ] Land on `/checkout` (no params), `/classes/xxxx`, `/workshops/xxxx` — confirm A5 + C9 fallbacks render.
- [ ] Re-run the `redesign-flow-gap-analysis.md` diff after A1/A2/C3 land to make sure the v1.3 regressions are actually closed.
