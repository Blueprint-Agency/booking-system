# Implementation Plan: Fix Navigation, Homepage and User Journey

## Executive Summary

The Booked4U frontend mockup currently behaves like a single-studio portal (hardcoded to "sunrise-yoga") instead of the multi-tenant SaaS marketplace it should be. This plan transforms the homepage into a marketplace landing, fixes the global navigation, creates proper studio sub-navigation, removes duplicate routes, and establishes a coherent user journey.

---

## Architecture Decision: Tabs vs. Separate Routes for Studio Offerings

**Decision: Use tabs within the studio profile page (/explore/[slug]), NOT separate routes.**

Rationale:
1. The studio profile page already has a tab system (currently "sessions" and "about").
2. No page files exist for /explore/[slug]/classes, /workshops, /packages, or /private-sessions.
3. For a mockup, tabs are faster to implement, feel more cohesive, and avoid needing a studio-level layout.tsx.
4. The session data has a type field (regular, workshop, event) for filtering into tabs.
5. Products/packages data can be displayed in a Packages tab.
6. Tabs keep the user on a single page with context (studio header/cover stays visible).

The sessions detail page (/explore/[slug]/sessions/[id]) remains as a separate route.
---

## Phase 1: Fix the Global Navigation (client-nav.tsx)

**File:** fe/src/components/layout/client-nav.tsx

### Changes:
1. **Remove** the hardcoded STUDIO_SLUG = "sunrise-yoga" constant entirely.
2. **Remove** the NAV_LINKS array that points to /explore/sunrise-yoga/*.
3. **Replace** with PRD-compliant navigation:

**Unauthenticated state:**
- Logo (to /) | Explore (to /explore) | spacer | Log In button (to /login)

**Authenticated state:**
- Logo (to /) | Explore (to /explore) | My Bookings (to /account) | spacer | Avatar dropdown

4. **Avatar dropdown** (authenticated): Implement a simple dropdown with:
   - Account (to /account/profile)
   - My QR Code (to /account/qr)
   - Divider
   - Log Out (mock -- just logs to console)

5. **Scroll behavior**: Add scroll-based transparency:
   - On homepage: start transparent, transition to solid on scroll (useEffect + scroll listener, threshold ~50px)
   - Detect homepage via usePathname() === "/" -- no prop drilling needed
   - On all other pages: always solid

6. **Mobile drawer**: Update to match -- show Explore, My Bookings (if auth), Account links, Log Out.

7. **Remove** the All Studios link currently tucked in the nav.

### Implementation details:
- Keep isAuth = true mock for prototype
- Use useState for dropdown open/close and scroll state
- Use useEffect with scroll event listener for transparency

---

## Phase 2: Rewrite the Homepage (page.tsx)

**File:** fe/src/app/(client)/page.tsx

### Complete rewrite with these sections:

#### Section 1: Hero
- Headline: "Discover yoga classes, workshops & private sessions" (font-serif, large)
- Subtitle: "Book with top studios -- all in one place."
- CTA button: "Explore Classes" -> /explore
- Keep existing warm gradient background blobs
- Centered text, generous padding (py-20 sm:py-32)

#### Section 2: Featured Studios (keep & improve existing)
- Keep horizontal scrolling studio cards (already work well)
- Each card links to /explore/[slug] (already correct)
- Add "View All Studios" link pointing to /explore
- Remove STUDIO_SLUG constant and all references

#### Section 3: How It Works (keep existing)
- Keep the 3-step section (Browse, Book, Show up with QR)
- Already matches PRD well. No substantive changes needed.

#### Section 4: Category Grid (NEW)
- Title: "Browse by Category"
- Grid (2 cols mobile, 3 cols desktop)
- Categories: Fitness, Wellness, Arts & Crafts, Music, Cooking, Education
- Each links to /explore?category=[industry]
- Each card: gradient/colored background, icon, category name, tagline
- Framer Motion fadeUp animation

#### Section 5: Footer (fix existing)
- Remove all hardcoded /explore/sunrise-yoga/* links
- Replace footer nav with: Explore (/explore), For Business (/for-business), Pricing (/pricing)
- Keep logo and copyright

### Data changes:
- Remove STUDIO_SLUG constant
- Remove MAIN_PAGES array entirely
- Keep importing tenants for Featured Studios
- Remove studio lookup


---

## Phase 3: Enhance Studio Profile Page with Tabbed Sub-Navigation

**File:** fe/src/app/(client)/explore/[slug]/page.tsx

### Expand tab system from 2 tabs to 5:
- **Classes** (default) -- sessions where type === "regular"
- **Workshops** -- sessions where type === "workshop" or type === "event"
- **Packages** -- products from products.json
- **Private Sessions** -- mock placeholder content
- **About** -- keep existing

### Tab state type:
Change from "sessions" | "about" to: "classes" | "workshops" | "packages" | "private-sessions" | "about"

### Classes tab:
- Filter tenantSessions to type === "regular"
- Display as session cards, each linking to /explore/[slug]/sessions/[id]
- Show count in tab label: e.g. Classes (8)

### Workshops tab:
- Filter to type === "workshop" || type === "event"
- Same card layout, show count in tab label

### Packages tab:
- Import products from data/products.json and Product type from types/index.ts
- Grid of package cards: name, price, description, session count, expiry
- Buy button links to /checkout?product=[id]&studio=[slug]
- Group by type: Drop-in, Packages, Memberships
- Note: products have no tenantId -- show all for prototype

### Private Sessions tab:
- Placeholder card: "1-on-1 or 2-on-1 personal training. Contact the studio to book."
- Could show studio instructors as available for private sessions

### URL query support for tabs:
- Use useSearchParams() to read ?tab=workshops from URL
- Default to "classes" if no param
- Update URL on tab change with router.replace
- Wrap with Suspense boundary (required by Next.js for useSearchParams)

---

## Phase 4: Fix Explore Page Category Filtering from URL

**File:** fe/src/app/(client)/explore/page.tsx

### Changes:
1. Use useSearchParams() to read ?category=Fitness
2. Pre-select industry filter if param exists
3. Wrap with Suspense
4. No other changes needed -- explore page already works well


---

## Phase 5: Remove Duplicate Global Sessions Route and Fix References

### Files to DELETE:
- fe/src/app/(client)/sessions/page.tsx
- fe/src/app/(client)/sessions/[id]/page.tsx

### Fix references to deleted routes:

**fe/src/components/session-card.tsx** (line 29):
- Remove the fallback href to /sessions/[id] -- all callers already pass href explicitly

**fe/src/app/(client)/account/page.tsx** (lines 160, 184, 203):
- Line 160: "Browse Sessions" link -- change from /sessions to /explore
- Line 184: Session name link -- change to /explore/[tenantSlug]/sessions/[id] (requires tenant slug lookup)
- Line 203: "Reschedule" link -- change from /sessions to /explore
- Add tenant lookup helper: import tenants.json, find slug by tenantId


---

## Phase 6: Improve Checkout Flow Context

**File:** fe/src/app/(client)/checkout/page.tsx

### Changes:
1. Read query params (product ID, studio slug) via useSearchParams()
2. Look up product in products.json by ID
3. Display dynamically instead of hardcoded "Standard Pack (10 sessions)"
4. Fallback to current hardcoded values if no params (backwards compatible)
5. Add back-to-studio link using studio slug
6. Wrap with Suspense for useSearchParams


---

## Implementation Order and Dependencies

- Phase 1: client-nav.tsx (no dependencies, start immediately)
- Phase 2: page.tsx homepage (depends on Phase 1 for nav transparency)
- Phase 3: [slug]/page.tsx (independent of Phase 1-2)
- Phase 4: explore/page.tsx (independent, very small change)
- Phase 5: Delete sessions routes (do after Phase 3)
- Phase 6: checkout/page.tsx (do after Phase 3)

Recommended sequence: **1 -> 2 -> 3 -> 4 -> 5 -> 6**

Phases 3 and 4 can run in parallel with Phase 2.


---

## Files Modified Summary

| # | File | Action | Phase |
|---|------|--------|-------|
| 1 | fe/src/components/layout/client-nav.tsx | Rewrite | 1 |
| 2 | fe/src/app/(client)/page.tsx | Rewrite | 2 |
| 3 | fe/src/app/(client)/explore/[slug]/page.tsx | Major enhancement (add 3 new tabs) | 3 |
| 4 | fe/src/app/(client)/explore/page.tsx | Minor update (read category from URL) | 4 |
| 5 | fe/src/app/(client)/sessions/page.tsx | Delete | 5 |
| 6 | fe/src/app/(client)/sessions/[id]/page.tsx | Delete | 5 |
| 7 | fe/src/components/session-card.tsx | Minor fix (remove fallback href) | 5 |
| 8 | fe/src/app/(client)/account/page.tsx | Minor fix (update session links) | 5 |
| 9 | fe/src/app/(client)/checkout/page.tsx | Enhancement (read query params) | 6 |


---

## New User Journey After Implementation

1. Landing (/) -> Hero CTA or Category Grid
2. Explore (/explore) -> Studio directory with search & category filters
3. Studio Profile (/explore/sunrise-yoga) -> Tabbed: Classes | Workshops | Packages | Private Sessions | About
4. Session Detail (/explore/sunrise-yoga/sessions/ses-1) -> Book or buy package
5. Checkout (/checkout?product=prod-4&studio=sunrise-yoga) -> Payment
6. Confirmation (/booking/confirmation) -> Success + View My Bookings
7. Account (/account) -> Upcoming bookings, packages, membership


---

## Potential Risks and Mitigations

1. **Products have no tenantId**: Show all products on every studio Packages tab for the prototype. Document as TODO for backend.
2. **Private sessions have no data model**: Create a static placeholder tab.
3. **Session type mapping**: Map "regular" to Classes tab, "workshop" + "event" to Workshops tab.
4. **useSearchParams requires Suspense**: Add Suspense boundaries in affected pages (Phases 3, 4, 6).


---

## Design Token Usage

All new UI elements should use existing design tokens:
- Headlines: font-serif (DM Serif Display)
- Body/UI: font-sans (Outfit) -- default
- Code/mono: font-mono (JetBrains Mono)
- Colors: text-ink, text-muted, bg-paper, bg-warm, bg-card, border-border, bg-accent, text-accent-deep, bg-accent-glow, bg-sage, bg-sage-light
- Shadows: shadow-soft, shadow-hover, shadow-modal
- Animations: Continue using Framer Motion fadeUp variant pattern consistent with existing pages