# Frontend Redesign — Rezerv-Inspired Visual System

**Date:** 2026-04-18
**Status:** Draft for review
**Owner:** chris
**Scope:** Full visual redesign of the `fe/` Next.js app
**Reference:** [rezerv.co](https://www.rezerv.co/)

---

## 1. Goal & Premise

The current frontend (Next.js 16 + Tailwind v4, ~25 routes shipped) functions correctly but reads as generic "warm minimal SaaS" — what the user described as "AI slop." The redesign keeps the existing information architecture, routes, and PRD scope, and re-skins the experience with a **rezerv.co-inspired visual system**: photography-led, geometric-sans-typeset, big-and-confident, with a friendly conversational tone.

**Non-goals:**
- No PRD changes. Same 25 routes, same flows.
- No backend work.
- No new features.
- Not a 1:1 clone of rezerv.co — we borrow design DNA, not copy.

**Tension we are explicitly designing around:** rezerv.co is a B2B marketing site (one page to convert studio owners). Our app is a B2C client portal (25 functional pages for end users). We mirror rezerv's section structure on marketing pages and apply its visual language to functional pages.

---

## 2. Design Tokens

All tokens live in `fe/src/app/globals.css` (Tailwind v4 `@theme` block).

### 2.1 Typography
| Token | Value | Notes |
|---|---|---|
| `--font-sans` | `"Manrope", system-ui, sans-serif` | Single family — drop DM Serif Display + Outfit |
| `--font-mono` | `"JetBrains Mono", monospace` | Keep |

**Weight scale:** 400 (body), 500 (UI labels), 700 (subheads), 800 (hero headlines)
**Type scale:** 12 / 14 / 16 / 18 / 20 / 24 / 32 / 48 / 64 / 80 px
**Line height:** 1.1 for h1-h2, 1.25 for h3-h4, 1.6 for body
**Letter spacing:** -0.02em on hero headlines, default elsewhere

### 2.2 Color
Keep the existing palette, recalibrate for photo-heavy layouts.

| Token | Value | Change | Usage |
|---|---|---|---|
| `--color-paper` | `#faf9f6` | keep | Page background |
| `--color-warm` | `#f5f0e8` | keep | Section banding, soft cards |
| `--color-card` | `#ffffff` | keep | Elevated surfaces |
| `--color-ink` | `#1f1d1a` | softened (was `#1a1a2e`) | Body + headlines |
| `--color-muted` | `#6b6862` | warmer | Secondary text |
| `--color-border` | `#ece8e0` | lighter | Hairlines (use sparingly) |
| `--color-accent` | `#c4956a` | keep, use bolder | Primary CTA, links, active states |
| `--color-accent-deep` | `#a67548` | keep | Hover, emphasis |
| `--color-sage` | `#7a8f72` | keep | Success, "available" status |
| `--color-error` | `#c45a5a` | keep | Errors |
| `--color-warning` | `#d4a843` | keep | Warnings |
| `--color-overlay` | `rgba(31,29,26,0.45)` | new | Photo overlay for hero legibility |

**Removed:** the dark sidebar tokens (`--color-sidebar-*`). The redesign uses light surfaces throughout.

### 2.3 Spacing, radius, shadow
| Token | Value | Notes |
|---|---|---|
| `--radius-sm` | `6px` | Buttons, inputs (was 8) |
| `--radius-md` | `10px` | Cards (was 12) |
| `--radius-lg` | `16px` | Hero cards, modals (was 16) |
| `--radius-xl` | `24px` | Photo containers |
| `--shadow-soft` | `0 1px 3px rgba(31,29,26,0.06), 0 8px 24px rgba(31,29,26,0.04)` | Lighter, more layered |
| `--shadow-hover` | `0 4px 12px rgba(31,29,26,0.08), 0 16px 40px rgba(31,29,26,0.06)` | |

Reasoning: rezerv leans on photo edges and whitespace for separation, not heavy shadows. Tighter radii feel more confident.

### 2.4 Motion
- Page-enter: `fadeUp` 400ms (down from 600ms) — subtler
- Hover: 200ms ease-out
- Image hover: 1.03 scale + 600ms ease

---

## 3. Section Patterns (the visual building blocks)

These patterns appear across pages in different combinations.

### 3.1 Hero (full-bleed photo)
- Full-viewport-width background image, 70vh on desktop, 60vh on mobile
- Dark overlay (`--color-overlay`) for legibility
- Left-aligned headline (Manrope 800, 64–80px) with optional rotating word
- Sub-headline (Manrope 400, 18px, max 60ch)
- Two CTAs: primary terracotta + ghost-white secondary
- Optional rotating background images (rezerv-style carousel, 4s interval, fade transition)

### 3.2 Trusted-by strip
- White section with thin top/bottom border
- "Trusted by" eyebrow label centered
- Logo row (grayscale, hover → color), 5–7 logos, equal spacing

### 3.3 Feature icon grid
- 6 or 7-column row, single icon + one-line label per item
- Wraps to 3-column on tablet, 2-column on mobile
- Icons from lucide (already installed); 24px stroke 1.5

### 3.4 Feature deep-dive
- Two-column: large screenshot left (60%), text block right (40%)
- Alternates direction every other deep-dive
- Text: small eyebrow → big headline (Manrope 700, 32px) → 1 paragraph → 3 bulleted benefits → optional inline CTA link
- Screenshot framed in `--radius-lg` rounded container with subtle shadow

### 3.5 Categories / studios showcase
- Photo-card grid, 3-column desktop, 2 tablet, 1 mobile
- Each card: photo (16:9), label overlay bottom-left, hover zoom on photo

### 3.6 Testimonial / quote band
- `--color-warm` background section
- Large pull-quote (Manrope 500, 32px), name + role below

### 3.7 CTA banner
- Full-bleed image, dark overlay, centered headline + button
- Lives at the bottom of every marketing page

### 3.8 Inline calendar / functional surface
- Light cream card on `--color-paper` page bg
- Internal hairline dividers, no heavy borders
- Photo accents per row when applicable (instructor avatar, class category thumb)

---

## 4. Layout Shell

### 4.1 Top navigation
- White bg, 1px bottom border `--color-border`, 72px height
- Logo left (Manrope 800, 24px wordmark for now)
- Center links: Classes • Workshops • Private Sessions • Packages • My Bookings
- Right: Sign In (ghost) + primary CTA "Book a class" (terracotta)
- Mobile: hamburger drawer slides in from right

### 4.2 Footer
- `--color-ink` background, paper text
- 4-column: Brand blurb / Studio (locations, hours) / Legal (terms, privacy) / Contact (WhatsApp, email)
- Bottom row: copyright + social icons

### 4.3 Page widths
- `max-w-[1280px]` content area, 64px side gutters desktop, 24px mobile
- Hero sections break out to full viewport width

---

## 5. Page-by-Page Application

### 5.1 Marketing pages (mirror rezerv structure)

**`/` Landing** — Re-skinned in rezerv pattern:
1. Hero with rotating word (e.g., "Book your next [yoga / pilates / meditation] class") + rotating background images
2. Trusted-by strip (placeholder logos for now)
3. Feature icon grid (6 items: Easy Booking, Class Packages, Private Sessions, Workshops, QR Check-in, Referral Rewards)
4. Three feature deep-dives (alternating direction): Calendar booking, Credit packages, Multi-location support
5. Categories showcase (Yoga / Pilates / Meditation / Workshops — with photos)
6. Testimonial band (single quote, placeholder)
7. CTA banner

**`/pricing`** — Hero (smaller) → 3-tier plan card row → FAQ accordion → CTA banner

> **Note on `/explore` and `/explore/[slug]`:** The PRD defines a studio directory + studio profile. The current `fe/` implementation collapsed these into top-level routes (`/classes`, `/packages`, etc.) for the single-tenant Yoga Sadhana prototype. We do **not** add `/explore` routes in this redesign — that's a future phase when multi-tenant directory becomes relevant.

### 5.2 Functional booking pages (apply visual language only)

**`/classes`** — Compact hero band with title + filter row → calendar grid (existing structure) restyled with new tokens, photo thumbnails on each session card → "Need a package?" inline cross-sell card → footer

**`/packages`** — Compact hero → tabbed sections (Bundle / Unlimited / Private) → package cards with bold pricing in Manrope 800 → "Why packages?" deep-dive → CTA banner

**`/workshops`** — Compact hero → photo-led card list (showcase pattern §3.5 adapted to single-column with more detail per card) → CTA banner

**`/private-sessions`** — Compact hero → instructor grid (3-col, photo cards) → request flow

**`/booking/confirmation`, `/checkout`** — Centered single-column, no hero. Lots of whitespace, big confirmation iconography.

### 5.3 Account pages (`/account/*`)
- Sidebar nav on desktop (220px), horizontal tab bar on mobile
- Each page: small page header (no hero), content area on `--color-card`
- `/account/qr` features the QR prominently (320px), session selector below
- `/account/referral` borrows the deep-dive pattern §3.4 to explain how referrals work

### 5.4 Auth pages
- Split-screen on desktop: full-height photo left (50%), form right (50%) centered vertically
- Mobile: photo collapses to 30vh banner, form below
- Same pattern for `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/waiver`

---

## 6. Photography Strategy

**15-image curated Unsplash set**, organized:
- 4× hero-grade lifestyle (people in yoga/pilates poses, studio interiors)
- 4× category showcase (yoga, pilates, meditation, workshop)
- 4× CTA banners (warm, atmospheric, end-of-page mood)
- 3× auth split-screen (calm, neutral, person-not-foregrounded)

Stored in `fe/public/images/` with consistent naming: `hero-yoga-01.jpg`, `category-pilates.jpg`, etc. Manifest in `fe/src/data/images.ts` to swap easily.

**Placeholder slots** (filled later when client provides):
- Studio cover image (`/explore/[slug]`)
- Instructor headshots (4× — Yoga Sadhana instructors)
- Studio interior shots (Breadtalk IHQ + Outram Park)

For each placeholder slot: ship a tasteful Unsplash fallback now, document in a TODO list at `docs/superpowers/specs/photo-todo.md` for client to replace.

**Image treatment:** consistent warm tonal bias (sepia 5%, slight contrast lift). Apply via Tailwind utility class `.photo-warm` defined in globals.css.

---

## 7. Component Library Updates

Existing components in `fe/src/components/` to update:

| Component | Change |
|---|---|
| `layout/client-nav.tsx` | New nav style §4.1 |
| `layout/role-switcher.tsx` | Keep as-is (dev tool) |
| `session-card.tsx` | Add photo thumbnail slot, restyle per new tokens |
| `status-badge.tsx` | Lowercase text, lighter weight |
| `capacity-bar.tsx` | Thinner, sage-on-warm |
| `empty-state.tsx` | Bigger illustration slot, friendlier copy tone |
| `location-filter.tsx` | Pill-style toggle |

New components to add:
- `layout/site-footer.tsx` — 4-column footer §4.2
- `marketing/hero.tsx` — full-bleed hero §3.1 (variant prop: `rotating | static | compact`)
- `marketing/feature-grid.tsx` — §3.3
- `marketing/feature-deep-dive.tsx` — §3.4 with `direction` prop
- `marketing/showcase-grid.tsx` — §3.5
- `marketing/testimonial.tsx` — §3.6
- `marketing/cta-banner.tsx` — §3.7
- `marketing/trusted-by.tsx` — §3.2
- `auth/auth-split-shell.tsx` — split-screen layout §5.4

---

## 8. Implementation Phasing

Each phase is a discrete unit of work that can be reviewed independently.

### Phase A — Tokens + Shell (foundation)
1. Update `fe/src/app/globals.css` with new tokens (§2)
2. Swap fonts in `fe/src/app/layout.tsx` (Manrope only)
3. Build new `client-nav.tsx` (§4.1) and `site-footer.tsx` (§4.2)
4. Add `photo-warm` utility, set up `fe/public/images/` + `fe/src/data/images.ts`
5. Install Unsplash image set

**Deliverable:** existing pages render with new typography/colors; nothing else has changed.

### Phase B — Marketing pages
1. Build the 7 marketing components (`marketing/*`)
2. Rebuild `/` to mirror rezerv structure (§5.1)
3. Rebuild `/pricing`

**Deliverable:** marketing surface area visually matches the rezerv DNA.

### Phase C — Functional booking pages
1. Restyle `/classes` (calendar inside compact-hero band)
2. Restyle `/packages` with tabbed sections + new package cards
3. Restyle `/workshops`, `/private-sessions`
4. Restyle `/booking/confirmation`, `/checkout`

**Deliverable:** booking flow visually consistent with marketing.

### Phase D — Account, auth, polish
1. Account sidebar + content area restyle
2. Auth split-screen pattern (`auth/auth-split-shell.tsx`)
3. Empty states, loading skeletons
4. Mobile responsive pass on all pages
5. Stitch-generated mockups for spot-checks where unsure

**Deliverable:** every route reskinned end-to-end.

---

## 9. Validation & Tooling

- **Stitch MCP** — generate variant mockups for high-stakes pages (landing hero, classes calendar, package cards) before committing to code
- **Playwright MCP** — screenshot every route after each phase, compare before/after
- **Manual review** — show user the live dev server after each phase via Playwright snapshots

---

## 10. Out of Scope

- Backend work, API integration
- Adding/removing PRD-defined features
- Marketing copy rewrites (keep existing copy unless visually awkward)
- Real client photography (client supplies later)
- Admin dashboard, staff tools
- i18n
- Dark mode

---

## 11. Open Questions

None remaining at design level. Implementation plan will surface its own questions.
