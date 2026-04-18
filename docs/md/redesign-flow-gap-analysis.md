# Redesign Flow Gap Analysis

**Date:** 2026-04-19
**Context:** Comparing HEAD (`21e394e`) against the pre-redesign v1.3 (`a16d5f3`) to identify missing user-journey and payment logic after the main-branch design revamp.

## Reference clarification

The commit hash you gave (`21e394eb9fbd9961db1d05f7cddd32f1250c3f2e`) **is the current `HEAD`**, not a previous commit. `git rev-parse HEAD` and `git rev-parse 21e394e` return the same SHA, so diffing HEAD against 21e394e produces empty output.

The actual "source-of-truth previous" commit on `main`'s lineage is **`a16d5f3` (v1.3)** — the commit immediately before the redesign work landed. All diffs below are `a16d5f3 → 21e394e` for the 8 booking-flow pages under `fe/src/app/(client)/`.

**Separate branch worth noting:** `redesign/phase-c-booking` (tip `509816e`) contains a full Phase-C polished version of all booking pages that was **never merged into main**. That branch adds ~10–20 lines per page over HEAD but doesn't contain the logic the user is missing — the feature losses documented below happened inside the redesign itself, not between main and that branch.

## Summary table

| Page | File | v1.3 lines | HEAD lines | Net | Severity |
|---|---|---:|---:|---:|---|
| Classes list | `fe/src/app/(client)/classes/page.tsx` | 491 | 401 | **−90** | Medium |
| Booking confirmation | `fe/src/app/(client)/booking/confirmation/page.tsx` | 458 | 314 | **−144** | **High** |
| Checkout | `fe/src/app/(client)/checkout/page.tsx` | 220 | 392 | +172 | Improved |
| Packages | `fe/src/app/(client)/packages/page.tsx` | 319 | 306 | −13 | Low |
| Workshops list | `fe/src/app/(client)/workshops/page.tsx` | 266 | 113 | **−153** | **High** |
| Workshop detail | `fe/src/app/(client)/workshops/[id]/page.tsx` | 115 | 134 | +19 | Low |
| Private sessions list | `fe/src/app/(client)/private-sessions/page.tsx` | 160 | 149 | −11 | Medium |
| Private-session detail | `fe/src/app/(client)/private-sessions/[id]/page.tsx` | 239 | 275 | +36 | Low |

---

## Flow 1 — Class booking (the one you flagged)

### What v1.3 had and HEAD lost

1. **"Deduct credit from" package picker** — when the user holds multiple packages, a radio group on the booking confirmation page let them choose which package to burn a credit from. Guard: `hasMultiplePackages && …`. Data source: `MOCK_USER.classPackages[]` with `{ id, name, creditsRemaining, creditsTotal, unlimited, expiresAt }`. **This is the exact gap you called out.**
2. **Credit summary panel** — `"1 credit will be used · {package name} · X credits remaining after booking"`, with live recomputation based on the selected package.
3. **Pre-confirmation step** — v1.3's `/booking/confirmation?type=class&session=X` was a *two-stage* page: a session-details view with a **Reserve Now** button, then a success dialog after the button is clicked. HEAD skips straight to the success/QR hero — no chance to review and no explicit "Reserve Now" click.
4. **Cancellation policy panel** — inline reminder: "more than 3 hours before — full credit refund" / "within 3 hours — no refund" / "repeated last-minute cancellations may result in a booking restriction".
5. **Remaining balance in success dialog** — post-booking success showed the updated credit count with a progress bar and package expiry date.
6. **Studio-specific arrival copy** — "Please arrive at **{location name}** 15 minutes before class to sign in and settle in" (HEAD: generic "arrive early").
7. **Per-session credit hint on the classes calendar** — v1.3 rendered `"1 credit · X left"` or `"unlimited credits"` or `"no credits"` under each class card. HEAD removed this per-card hint; only the page-level credit badge remains.

### What HEAD gained (kept)

- QR code via `qrcode.react` with `YS-BOOKING-{sessionId}` reference
- "What's next" tips section (arrive early, bring water, comfortable clothing)
- `CtaBanner` closing CTA
- `BookingSurface` + `SectionHeading` visual primitives
- `"Add to calendar"` mock button

### Net: **High priority gap.** Package selector + pre-confirmation Reserve step + credit summary + cancellation policy all need to be re-added to `booking/confirmation/page.tsx` for the class flow.

---

## Flow 2 — Workshops purchase

### What v1.3 had and HEAD lost (list page)

1. **Expandable workshop cards** — clicking a card header opened an inline accordion (`AnimatePresence`) with full details, instructor bio, and pricing tiers. HEAD replaced this with simple photo tiles that link out.
2. **Multi-tier package pricing on list** — `session.workshopPackages[]` was rendered as individual price rows, each with its own "Purchase" button that preselected the tier via `/workshops/{id}?package={i}`. HEAD only shows `"From S$X"` and drops the `?package=` query entirely.
3. **Free-workshop "Register" vs paid "Purchase" distinction** — v1.3 differentiated copy and routing for `price === 0`.
4. **Waitlist CTA** — when a workshop is full (but not past) and `session.waitlistEnabled`, a "Join waitlist" link appeared. HEAD has no waitlist affordance.
5. **Disabled-state contextual labels** — "Workshop Ended" / "Fully Enrolled" vs HEAD's single "Ended"/"Full" badge.
6. **Level badge with colour variants** — beginner/intermediate/advanced/all, each with its own sage/warning/error/accent palette.
7. **"Direct payment only — credits cannot be used"** clarification note.
8. **Spots-left counter on the list card** — "X of N spots left" shown per card; HEAD only shows seats on the detail page.

### Detail page

- v1.3 had a simple "Price per person: S$X" block + "Purchase Now" button linking to `/checkout?session={id}&type=workshop`.
- HEAD has a sticky right-rail purchase card with `"Reserve your seat"` (label changed), seat count, and larger layout.
- **Both link to the same `/checkout` route, so the Stripe flow is intact.**
- **Lost copy change:** button label "Purchase Now" → "Reserve your seat". Per PRD §4.4 the spec wording is **"Purchase Now"**.

### Net: **High priority gap.** Reinstate waitlist, multi-tier pricing selector, free-vs-paid distinction, and "Purchase Now" copy.

---

## Flow 3 — Private sessions request

### What v1.3 had and HEAD lost

1. **"How private sessions work" info panel** — bulleted rules that set expectations before the user submits:
   - "Submit a session request — no upfront payment needed"
   - "We confirm availability and details within 12 hours"
   - "Once confirmed, your PT package is activated"
   - "Sessions use PT credits (1 credit = 30 mins) — separate from group class credits"
   - "You can hold multiple PT packages and credits are auto-deducted from the soonest-expiring one"
   - HEAD removed this entirely.
2. **Location preference badges on instructor cards** — v1.3 listed each instructor's working locations inline.
3. **Success-dialog microcopy on detail page** — v1.3 after "Request Appointment" showed: *"We've noted your interest in a private session with {instructor} at {location}. Our team will reach out within **12 hours**…"* HEAD still references PT credits but the **explicit "12 hours" SLA phrasing** is no longer surfaced prominently.
4. **"Not Available" disabled CTA** for unavailable instructors (clean disabled state).

### What HEAD gained

- Step-1 form on the list page (instructor + location + date) that pre-fills the detail page via query params
- Time-slot chooser on the detail page (`phase-c-booking` work)
- PT credit balance cards (1-on-1 / 2-on-1) — these are **preserved** in HEAD at `private-sessions/[id]/page.tsx:123` and `:258`

### Net: **Medium priority.** Reinstate the 12-hour SLA messaging and the "How private sessions work" info panel. The core request flow still exists.

---

## Flow 4 — Package purchase

### Status: **Mostly improved.**

- v1.3 had flat tabs (Bundle / Unlimited / Private) with `"Most popular"` highlight and `"Coming soon"` pending badges.
- HEAD reorganised into main tabs **Class Credits / PT 1-on-1 / PT 2-on-1**, with a **Bundle / Unlimited** sub-toggle under Class Credits.
- Both link to `/checkout?package={id}` — **payment routing intact.**
- Cards in HEAD use the new visual language (`BookingSurface`, Manrope bold pricing).

### Minor losses

- `"Most popular"` highlight badge present in data (`highlight: true` on `b-20`, `u-6`) — verify it's still rendered visually in HEAD.
- `"Coming soon"` pending badge present in data (`pending: true` on `b-travel`) — verify.

---

## Flow 5 — Checkout

### Status: **Significantly improved — PRD-aligned.**

- v1.3 had a **single-page** checkout (Order Summary + pre-filled card form). Did NOT match the PRD which specifies a 3-step flow.
- HEAD has the spec-correct **3-step flow**: `STEP_LABELS = ["Personal info", "Pay with", "Review"]`, Continue buttons between steps, sticky right-rail order summary, GST 9% line item, Terms-of-Service footer, empty-cart handling.
- The `PACKAGE_CATALOGUE` and `allSessions` data are unchanged.

**No action needed here** — this is the checkout the PRD asked for.

---

## Prioritised action list

### P0 — must restore before shipping redesign

1. **Add "Deduct credit from" package picker** back to `fe/src/app/(client)/booking/confirmation/page.tsx` when `type=class` and user holds ≥2 packages. Reference: v1.3's `hasMultiplePackages` block reading `MOCK_USER.classPackages[]`.
2. **Restore the pre-confirmation "Reserve Now" step** for class bookings so users see a review screen before the credit is deducted. Current HEAD jumps straight to the success hero.
3. **Restore the credit summary + cancellation policy panels** on the class-booking confirmation page.
4. **Restore waitlist CTA and multi-tier package pricing on `/workshops`** list cards.

### P1 — PRD-alignment polish

5. Rename workshop detail CTA **"Reserve your seat" → "Purchase Now"** (PRD §4.4).
6. Restore **12-hour SLA** copy in the private-session request success dialog and the "How private sessions work" info panel on the list page.
7. Restore **per-session credit hint** (`"1 credit · X left"`) under each class card in the calendar grid.
8. Surface **studio name** in the booking-confirmation arrival instructions.

### P2 — verify, no code guaranteed needed

9. Confirm **"Most popular"** and **"Coming soon"** badges still render on `/packages` in HEAD (data intact; UI only).
10. Confirm level badges (beginner / intermediate / advanced / all) with colour variants still appear on workshop cards in HEAD.

---

## Appendix: how to find the lost code quickly

```bash
# Full v1.3 → HEAD diff, per page
git diff a16d5f3 21e394e -- 'fe/src/app/(client)/booking/confirmation/page.tsx'
git diff a16d5f3 21e394e -- 'fe/src/app/(client)/classes/page.tsx'
git diff a16d5f3 21e394e -- 'fe/src/app/(client)/workshops/page.tsx'
git diff a16d5f3 21e394e -- 'fe/src/app/(client)/private-sessions/page.tsx'

# Read the v1.3 version of any page directly
git show 'a16d5f3:fe/src/app/(client)/booking/confirmation/page.tsx'
```

The Phase-C branch (never merged) also has some of these features in a newer visual form:

```bash
git checkout redesign/phase-c-booking -- 'fe/src/app/(client)/booking/confirmation/page.tsx'
```

— but it has its own gaps; `a16d5f3` is the cleaner source of truth for flow logic.
