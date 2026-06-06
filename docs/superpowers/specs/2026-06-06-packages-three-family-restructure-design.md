# /packages 3-family restructure — design

**Date:** 2026-06-06
**Scope:** fe-client only. No BE changes, no schema/migration, no new wire types.

## Goal

Restructure the member-facing `/packages` page from today's flat three tabs
(`Class Credits`, `PT 1-on-1`, `PT 2-on-1`) into three **package families**, and
surface admin-created Corporate packages there:

- **Group** → subtabs: Credit Bundles · Unlimited Access · Trial Pass *(auto-hides when none)*
- **Private** → subtabs: 1-on-1 · 2-on-1
- **Corporate** → corporate cards + "Contact us on WhatsApp" footer

The standalone `/corporate` catalog page is removed; `/packages#corporate` becomes
the single surface for the corporate catalog.

## Why this is small

The corporate read path is already live and consumed in fe-client:

- BE: `GET /me/corporate-packages` (authed) / `GET /public/corporate-packages` (signed-out)
  already return active corporate packages. (`be/src/routes/client/catalog.ts`,
  `be/src/routes/public/catalog.ts`)
- fe-client: `lib/corporate.ts` already exports `useCorporatePackages()`,
  `purchaseCorporate()`, `corporateContactWhatsappHref()`, and the `CorporateCard`
  markup lives in the page we are deleting.

So this is a presentation/IA change: rehome existing pieces, no new data plumbing.

## Decisions (locked)

1. **Trial Pass** stays as the 3rd subtab under **Group** (Credit / Unlimited / Trial).
   Keeps the existing trial-claim flow; still auto-hides when no trial package exists.
2. **Standalone `/corporate` catalog page is removed.** Corporate lives only inside
   `/packages`. The `account/corporate` *requests* page (member's corporate request
   history) is untouched.

## Changes

### `fe-client/src/app/(client)/packages/page.tsx`

- `MainTab` type: `"classCredits" | "pt1on1" | "pt2on1"` → `"group" | "private" | "corporate"`.
- Top tab strip labels: **Group · Private · Corporate**.
- Add a `private` subtab state (`"1on1" | "2on1"`) and a new `PrivateSection`
  component: a subtab strip (mirroring `ClassCreditsSection`) wrapping the existing
  `PtSection` for each session type. Reuses the existing `SHARED_BLURBS`.
- Add a `CorporateSection` component holding the `CorporateCard` (lifted from the
  deleted page) + the WhatsApp contact footer. Uses the existing `useCorporatePackages()`
  hook from `lib/corporate.ts`; filters to `status === "active"`.
- The page calls **both** `usePackagesCatalog()` (class+PT, unchanged) and
  `useCorporatePackages()`.
- `ClassCreditsSection` is reused as-is for **Group**; only the top-level label changes.

### Hash routing (back-compat preserved)

`fromHash()` maps:
- `#bundle`/`#bundles`/`#unlimited`/`#trial`/`#trial-pass` → `group` + matching sub
- `#pt1on1`/`#1on1`/`#1-on-1`/`#private` → `private` + `1on1`
- `#pt2on1`/`#2on1`/`#2-on-1` → `private` + `2on1`
- `#classcredits`/`#classes`/`#credits`/`#group` → `group`
- `#corporate` → `corporate`

### Auth-gate redirect

`CorporateCard`'s signed-out `requireAuth("/corporate")` → `requireAuth("/packages#corporate")`.

### Removals

- Delete `fe-client/src/app/(client)/corporate/page.tsx`.
- `fe-client/src/components/layout/app-nav-items.ts`: drop the now-dead
  `|| p.startsWith("/corporate")` clause from the Account item's `isActive`.
- Keep `lib/corporate.ts` (still used by the Corporate tab + account requests page).

## Verification

- `npx tsc --noEmit` in `fe-client/` (project lint is broken — gate on tsc + build).
- `next build` in `fe-client/`.
- Manual dogfood: each top tab + subtab renders; corporate cards load; back-compat
  hashes still land on the right tab.

## Out of scope

- BE changes of any kind.
- The `account/corporate` requests page.
- Promotions/pricing logic (unchanged).
