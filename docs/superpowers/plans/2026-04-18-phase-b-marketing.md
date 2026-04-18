# Frontend Redesign — Phase B: Marketing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build 7 reusable marketing components and rebuild the landing page (`/`) + pricing page (`/pricing`) to mirror the rezerv.co section flow, applying the Phase A visual foundation (Manrope + cream/terracotta palette + photography-led layouts).

**Architecture:** Components live under `fe/src/components/marketing/` and are pure presentation — no data fetching, no business logic. Each takes typed props and composes layout primitives. Pages compose them top-to-bottom mirroring rezerv's section pattern. Photography sourced from `fe/src/data/images.ts` (Phase A manifest).

**Tech Stack:** Next.js 16 App Router · React 19 (server components by default — `"use client"` only when needed for `motion`/state) · Tailwind v4 with Phase A tokens · framer-motion for entry animations · lucide-react v1.8.0 (limited icon set — use inline SVG when needed) · `next/image` for optimized photography.

**Reference spec:** `docs/superpowers/specs/2026-04-18-frontend-redesign-design.md` §3 (section patterns) and §5.1 (marketing pages).
**Phase A artifacts:** `docs/superpowers/plans/2026-04-18-phase-a-foundation.md`, tag `phase-a-foundation`.

---

## Working Conventions for All Phase B Tasks

These conventions apply to every component task — do not re-state them in each task; assume the implementer reads this section first.

**File structure:** One component per file in `fe/src/components/marketing/`. Each file exports exactly one named component (the component name) plus its props type.

**Imports:**
- React/Next: `import Link from "next/link"`, `import Image from "next/image"`
- Animations: `"use client"` directive at top + `import { motion } from "framer-motion"` ONLY if the component renders motion
- Icons: prefer inline SVG for brand/social icons (lucide-react v1.8.0 lacks brand icons); use `lucide-react` for utility icons (`ArrowRight`, `Check`, `Calendar`, etc.) — verify exports before importing
- Image manifest: `import { img } from "@/data/images"` then call `img("hero-yoga-01")` to get the entry
- Utility: `import { cn } from "@/lib/utils"` for conditional classes

**Layout invariants:**
- Content max-width: `max-w-[1280px] mx-auto px-6 sm:px-8` (matches Phase A nav and footer)
- Section vertical rhythm: `py-20 sm:py-28` for standard sections, `py-12 sm:py-16` for compact sections
- Hero sections break out to full viewport width — wrap inner content in the max-width container

**Typography hierarchy (within marketing components):**
- Eyebrow label: `text-[12px] font-bold uppercase tracking-wider text-accent-deep`
- Hero h1: `text-[48px] sm:text-[64px] lg:text-[80px] font-extrabold leading-[1.05] tracking-tight`
- Section h2: `text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight`
- Card h3: `text-[20px] sm:text-[24px] font-bold tracking-tight`
- Body lead: `text-[18px] leading-relaxed text-muted max-w-[60ch]`
- Body default: `text-[16px] leading-relaxed text-muted`

**Buttons:**
- Primary: `inline-flex items-center gap-2 px-6 py-3 text-[14px] font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200`
- Secondary (ghost light): `inline-flex items-center gap-2 px-6 py-3 text-[14px] font-bold text-ink border border-ink/15 rounded-md hover:border-ink/30 transition-colors duration-200`
- Secondary (ghost dark, on photos): `inline-flex items-center gap-2 px-6 py-3 text-[14px] font-bold text-paper border border-paper/30 rounded-md hover:bg-paper/10 transition-colors duration-200`

**Animations:**
- Entry: `motion.div` with `initial={{ opacity: 0, y: 16 }}`, `whileInView={{ opacity: 1, y: 0 }}`, `viewport={{ once: true, margin: "-100px" }}`, `transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}`
- Stagger children with `delay: i * 0.08` where applicable
- Skip motion entirely if a component is server-rendered

**Image loading:**
- Hero/banner images: `<Image src={img("...").unsplash} alt={img("...").alt} fill priority className="object-cover photo-warm" sizes="100vw" />` inside a `relative` wrapper
- Card images: same pattern but no `priority`, set `sizes` based on layout

**Image domain config:** Before any task that uses Unsplash images via `next/image`, ensure `fe/next.config.ts` allows `images.unsplash.com`. **Task 1 handles this** as part of the Hero work.

**Verification per task:**
1. `cd fe && npx tsc --noEmit` exits 0
2. `npm run build` exits 0 (catches Image domain errors that tsc misses)
3. Component renders in isolation — quickly verified by composing into a temporary `/dev` route OR (preferred) by mounting it on the landing page in Task 8 and screenshotting

**Commit one component per task** with message `feat(fe): phase B [component-name] — [one-line summary]`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `fe/next.config.ts` | Modify (Task 1) | Allow `images.unsplash.com` for `next/image` |
| `fe/src/components/marketing/hero.tsx` | Create (Task 1) | Full-bleed photo hero, rotating-word headline variant, dual CTA |
| `fe/src/components/marketing/trusted-by.tsx` | Create (Task 2) | Logo strip with eyebrow label |
| `fe/src/components/marketing/feature-grid.tsx` | Create (Task 3) | Icon-row grid (6 features) |
| `fe/src/components/marketing/feature-deep-dive.tsx` | Create (Task 4) | Two-column screenshot + bullet section, alternating direction |
| `fe/src/components/marketing/showcase-grid.tsx` | Create (Task 5) | Photo-card grid (categories/instructors/studios) |
| `fe/src/components/marketing/testimonial.tsx` | Create (Task 6) | Pull-quote band on warm background |
| `fe/src/components/marketing/cta-banner.tsx` | Create (Task 7) | Full-bleed image + centered CTA |
| `fe/src/app/(client)/page.tsx` | Replace (Task 8) | New rezerv-mirror landing composition |
| `fe/src/app/(client)/pricing/page.tsx` | Replace (Task 9) | New pricing layout: hero + tier cards + FAQ + CTA |

Visual verification (Task 10) writes only screenshots to `docs/superpowers/specs/phase-b-snapshots/`.

---

## Task 1: Hero component + Image domain config

**Goal:** A full-bleed photo hero with optional rotating-word headline and dual CTA — the most visually important component in Phase B.

**Files:**
- Modify: `fe/next.config.ts`
- Create: `fe/src/components/marketing/hero.tsx`

### Component contract

```ts
type HeroProps = {
  /** Image manifest key (from `@/data/images`). */
  imageKey: string;
  /** Optional eyebrow above the headline. */
  eyebrow?: string;
  /**
   * Headline. May contain a single `{rotating}` placeholder; if present,
   * `rotatingWords` rotates through them in that slot every 3 seconds.
   */
  headline: string;
  /** Words to rotate into the `{rotating}` slot. Required if `{rotating}` is in headline. */
  rotatingWords?: string[];
  /** Sub-headline / lead paragraph. */
  subheadline: string;
  /** Primary CTA. */
  primaryCta: { href: string; label: string };
  /** Optional secondary CTA. */
  secondaryCta?: { href: string; label: string };
  /** "compact" | "full" — full = 70vh, compact = 50vh */
  variant?: "compact" | "full";
};
```

### Visual structure

- Wrapper: `<section className="relative w-full">`. Height: `h-[70vh] min-h-[560px]` for `full`; `h-[50vh] min-h-[420px]` for `compact`.
- Background: `<Image fill priority className="object-cover photo-warm" sizes="100vw" />` resolving from `imageKey`.
- Overlay: absolute layer with `bg-[rgba(31,29,26,0.5)]` (slightly stronger than the global `--color-overlay` for hero text legibility).
- Content container: `relative z-10 max-w-[1280px] mx-auto px-6 sm:px-8 h-full flex flex-col justify-center`.
- Eyebrow (if provided): `text-[12px] font-bold uppercase tracking-wider text-paper/80 mb-4`.
- Headline: hero h1 type, color `text-paper`. Must support the rotating-word substitution: split on `{rotating}`, render the rotating word inside a `<span className="text-accent-glow">` (where `accent-glow` = `text-[#e8c9a8]` since the token isn't in the theme — use the literal class). Use AnimatePresence + motion.span keyed on the current word for fade-up swap.
- Subheadline: `text-[18px] sm:text-[20px] leading-relaxed text-paper/85 max-w-[60ch] mb-8`.
- CTA row: `flex flex-col sm:flex-row gap-3` — primary then secondary; secondary uses the dark-bg variant (`text-paper border border-paper/30 ...`).

### Rotating word implementation

```tsx
const [currentIndex, setCurrentIndex] = useState(0);
useEffect(() => {
  if (!rotatingWords || rotatingWords.length < 2) return;
  const id = setInterval(() => setCurrentIndex((i) => (i + 1) % rotatingWords.length), 3000);
  return () => clearInterval(id);
}, [rotatingWords]);
```

If `headline` contains `{rotating}`, split it: `const [before, after] = headline.split("{rotating}")`. Render `before`, then animated word, then `after`. If no rotating, just render the headline.

For the rotating word swap use AnimatePresence (mode="wait") + motion.span with `initial={{ y: 24, opacity: 0 }}`, `animate={{ y: 0, opacity: 1 }}`, `exit={{ y: -24, opacity: 0 }}`, `transition={{ duration: 0.4 }}`.

### Steps

- [ ] **Step 1: Add Unsplash to `next.config.ts` image domains.**

Read current `fe/next.config.ts` (it's a 109-byte file — should be near-empty). Replace with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 2: Create `fe/src/components/marketing/hero.tsx`.**

Implement per the contract + visual structure above. The file MUST start with `"use client";` (uses motion + useState + useEffect). Use `next/image` with the manifest's `unsplash` URL. Pull the entry via `img(imageKey)`.

When `rotatingWords` is provided, the headline must replace exactly one `{rotating}` token and animate through the words on a 3-second cycle.

When `rotatingWords` is absent or empty, render the headline literally (no animation, no `{rotating}` substitution).

Animations: hero content (eyebrow + headline + subheadline + CTAs) uses staggered fade-up on initial mount (NOT viewport-triggered — hero is above the fold).

- [ ] **Step 3: Verify.**

```bash
cd fe && npx tsc --noEmit && npm run build
```

Both must exit 0. The build must NOT fail with `Invalid src prop` errors — that means the next.config.ts domain config didn't take effect.

- [ ] **Step 4: Commit.**

```bash
git add fe/next.config.ts fe/src/components/marketing/hero.tsx
git commit -m "feat(fe): phase B hero — full-bleed photo with rotating-word headline"
```

### Done criteria

- TypeScript clean, build passes
- Hero accepts the props listed and renders as described
- Rotating word transitions smoothly (no layout shift between word swaps)
- Works with both `variant="full"` and `variant="compact"`

---

## Task 2: TrustedBy component

**Goal:** Thin section with eyebrow label and a row of partner/category logos.

**File:** Create `fe/src/components/marketing/trusted-by.tsx`.

### Component contract

```ts
type TrustedByProps = {
  /** Eyebrow text — defaults to "Trusted by". */
  label?: string;
  /** Logos to render. Each is a label + optional href. */
  logos: Array<{ name: string; href?: string }>;
};
```

For Phase B prototype, logos are rendered as **text wordmarks** (Manrope semibold, muted color) — actual SVG logos can be wired later. This keeps the component self-contained without needing logo assets.

### Visual structure

- `<section className="py-12 sm:py-16 border-t border-b border-border bg-paper">`
- Inner: `max-w-[1280px] mx-auto px-6 sm:px-8`
- Eyebrow: centered, `text-[12px] font-bold uppercase tracking-wider text-muted/70 mb-6`
- Logo row: flex-wrap, `gap-x-12 gap-y-4 justify-center items-center`
- Each logo: `text-[18px] font-extrabold tracking-tight text-muted hover:text-ink transition-colors`. Wrap in `<Link>` if `href` present, else plain `<span>`.

Server component (no `"use client"` needed). No animations.

### Steps

- [ ] **Step 1: Implement** per contract above.
- [ ] **Step 2: Verify** `cd fe && npx tsc --noEmit` exits 0.
- [ ] **Step 3: Commit**: `feat(fe): phase B trusted-by — logo strip`.

### Done criteria

- Renders eyebrow + horizontal logo row
- Wraps gracefully on small screens
- TypeScript clean

---

## Task 3: FeatureGrid component

**Goal:** Icon-row grid of short feature highlights — rezerv's "unique features" pattern.

**File:** Create `fe/src/components/marketing/feature-grid.tsx`.

### Component contract

```ts
type FeatureGridItem = {
  /** Lucide icon name (e.g., "Calendar", "Sparkles"). Must be a valid lucide-react v1.8.0 export — verify before using. */
  icon: string;
  label: string;
  description?: string;
};

type FeatureGridProps = {
  eyebrow?: string;
  headline?: string;
  /** 6 items recommended for a clean 6-col desktop grid; 4 or 8 also work. */
  items: FeatureGridItem[];
};
```

### Visual structure

- `<section className="py-20 sm:py-28">`
- Container: `max-w-[1280px] mx-auto px-6 sm:px-8`
- Header (optional, only renders if eyebrow/headline provided): centered, eyebrow + section h2 (max-w-[40ch] mx-auto), 16-px gap below, `mb-16`
- Grid: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-10` for 6-item layouts. If `items.length === 4`, use `lg:grid-cols-4`. If `items.length === 8`, use `lg:grid-cols-4 grid-rows-2`.
- Each item:
  - Icon container: `w-12 h-12 rounded-md bg-warm flex items-center justify-center mb-4`
  - Icon: rendered dynamically — use `import * as LucideIcons from "lucide-react"` then `const Icon = (LucideIcons as Record<string, React.ComponentType<{className?: string; strokeWidth?: number}>>)[item.icon]; if (!Icon) throw new Error(...);` Render with `className="w-5 h-5 text-accent-deep" strokeWidth={1.5}`
  - Label: `text-[14px] sm:text-[15px] font-bold text-ink leading-tight`
  - Description (if provided): `text-[13px] text-muted mt-1 leading-relaxed`

Server component. Use `motion` (with viewport trigger + stagger) for the items if you want a polish pass — wrap inside a `<MotionGrid>` client subcomponent. Keep the parent server.

### Steps

- [ ] **Step 1: Implement** per contract above. Throw a descriptive error if an icon name is missing from lucide-react.
- [ ] **Step 2: Verify** type-check + build.
- [ ] **Step 3: Commit**: `feat(fe): phase B feature-grid — icon row`.

### Done criteria

- Accepts 4, 6, or 8 items and lays them out responsively
- Icon name validation surfaces dev-time errors clearly
- TypeScript clean, build passes

---

## Task 4: FeatureDeepDive component

**Goal:** Two-column section: large screenshot/illustration on one side, headline + bullets + optional CTA on the other. Alternates direction across multiple instances.

**File:** Create `fe/src/components/marketing/feature-deep-dive.tsx`.

### Component contract

```ts
type FeatureDeepDiveProps = {
  eyebrow?: string;
  headline: string;
  body: string;
  bullets: string[];
  /** Image side. Default "right". Use "left" for alternating sections. */
  direction?: "left" | "right";
  /** Image manifest key OR an explicit src path under `/public`. */
  imageKey?: string;
  imageSrc?: string;
  imageAlt: string;
  /** Optional inline CTA link. */
  cta?: { href: string; label: string };
};
```

Exactly one of `imageKey` or `imageSrc` must be provided — throw if both/neither.

### Visual structure

- `<section className="py-20 sm:py-28">`
- Container: `max-w-[1280px] mx-auto px-6 sm:px-8`
- Inner grid: `grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center`
- When `direction === "left"`, image goes in `lg:order-1`, text in `lg:order-2`. Default (right) uses natural DOM order.
- Image side:
  - Wrapper: `relative aspect-[4/3] rounded-lg overflow-hidden shadow-soft`
  - Image: `<Image fill className="object-cover photo-warm" sizes="(min-width: 1024px) 50vw, 100vw" />`
- Text side:
  - Eyebrow (if provided)
  - h2 (section size)
  - Body paragraph: `text-[17px] leading-relaxed text-muted mt-4 mb-6`
  - Bullets: `<ul className="space-y-3">`. Each `<li className="flex gap-3 items-start text-[15px] leading-relaxed text-ink">`. Bullet marker: `<Check className="w-5 h-5 text-sage shrink-0 mt-0.5" strokeWidth={2} />` (lucide `Check` confirmed available in v1.8.0).
  - CTA (if provided): `inline-flex items-center gap-1.5 mt-8 text-accent-deep font-bold hover:text-accent transition-colors text-[15px]` with a chevron (`ChevronRight` from lucide).

Use `motion` for both columns with viewport trigger + 0.08s stagger between them. Make the file a client component for the motion.

### Steps

- [ ] **Step 1: Implement** per contract.
- [ ] **Step 2: Verify** type-check + build.
- [ ] **Step 3: Commit**: `feat(fe): phase B feature-deep-dive — alternating two-column section`.

### Done criteria

- `direction="left"` and `direction="right"` both render correctly with image visually on the named side at `lg+` viewports
- Mobile stacks image-then-text consistently regardless of direction
- Both `imageKey` and `imageSrc` paths work; passing neither/both throws
- TypeScript clean, build passes

---

## Task 5: ShowcaseGrid component

**Goal:** Photo-card grid for category/instructor/studio listings — rezerv's industries-showcase pattern.

**File:** Create `fe/src/components/marketing/showcase-grid.tsx`.

### Component contract

```ts
type ShowcaseItem = {
  imageKey?: string;
  imageSrc?: string;
  imageAlt: string;
  label: string;
  description?: string;
  href?: string;
};

type ShowcaseGridProps = {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  items: ShowcaseItem[];
  /** Number of columns at lg+ breakpoint. Defaults to 3. */
  columns?: 2 | 3 | 4;
};
```

### Visual structure

- `<section className="py-20 sm:py-28">`
- Container: `max-w-[1280px] mx-auto px-6 sm:px-8`
- Header (optional)
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-{columns} gap-6 lg:gap-8`
- Each card:
  - Wrapper: `<Link>` if `href` else `<div>`. `group block relative overflow-hidden rounded-lg shadow-soft hover:shadow-hover transition-shadow`
  - Image: `relative aspect-[4/5] overflow-hidden`. `<Image fill className="object-cover photo-warm transition-transform duration-700 group-hover:scale-105" sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" />`
  - Bottom gradient overlay: absolute, `bg-gradient-to-t from-ink/85 via-ink/30 to-transparent h-2/5 bottom-0 inset-x-0 pointer-events-none`
  - Caption (overlaid on bottom): absolute `bottom-0 left-0 right-0 p-5 sm:p-6 text-paper`. Label `text-[20px] font-extrabold tracking-tight`, description `text-[13px] text-paper/80 mt-1 leading-relaxed`.

Use motion for stagger on viewport entry.

### Steps

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** type-check + build.
- [ ] **Step 3: Commit**: `feat(fe): phase B showcase-grid — photo card grid`.

### Done criteria

- 2/3/4 column layouts all render
- Images scale on hover smoothly
- Caption legible over varied photographs (gradient overlay does its job)
- TypeScript clean, build passes

---

## Task 6: Testimonial component

**Goal:** Quote band on warm background. Single quote per instance.

**File:** Create `fe/src/components/marketing/testimonial.tsx`.

### Component contract

```ts
type TestimonialProps = {
  quote: string;
  attribution: { name: string; role?: string };
  /** Optional small avatar image manifest key. */
  avatarImageKey?: string;
};
```

### Visual structure

- `<section className="py-20 sm:py-28 bg-warm">`
- Container: `max-w-[960px] mx-auto px-6 sm:px-8 text-center`
- Open-quote glyph: large, `text-[80px] leading-[0.5] text-accent/30 font-extrabold mb-2 select-none`. Render `&ldquo;` (left double quote) or just `"`.
- Quote: `text-[24px] sm:text-[32px] leading-snug font-medium text-ink tracking-tight max-w-[44ch] mx-auto mb-8`
- Attribution row: `flex items-center justify-center gap-3`
  - If `avatarImageKey`: small `relative w-10 h-10 rounded-full overflow-hidden` with `<Image fill className="object-cover" sizes="40px" />`
  - Name + role stacked: name `text-[14px] font-bold text-ink`, role `text-[12px] text-muted`

Server component (no animation needed; or wrap in client motion if desired).

### Steps

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** type-check + build.
- [ ] **Step 3: Commit**: `feat(fe): phase B testimonial — pull-quote band`.

### Done criteria

- Quote-glyph renders without obscuring the quote
- Avatar slot is optional and graceful when absent
- TypeScript clean, build passes

---

## Task 7: CtaBanner component

**Goal:** Closing CTA section for marketing pages — full-bleed image with overlay and centered text + button.

**File:** Create `fe/src/components/marketing/cta-banner.tsx`.

### Component contract

```ts
type CtaBannerProps = {
  imageKey: string;
  eyebrow?: string;
  headline: string;
  subheadline?: string;
  primaryCta: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
};
```

### Visual structure

- `<section className="relative w-full h-[60vh] min-h-[480px] overflow-hidden">`
- Background image: `<Image fill className="object-cover photo-warm" sizes="100vw" />`
- Overlay: `absolute inset-0 bg-[rgba(31,29,26,0.6)]`
- Content: `relative z-10 max-w-[800px] mx-auto px-6 sm:px-8 h-full flex flex-col items-center justify-center text-center text-paper`
- Eyebrow (if provided): same eyebrow style with `text-paper/80`
- Headline: `text-[40px] sm:text-[56px] font-extrabold leading-[1.1] tracking-tight mb-5`
- Subheadline (if provided): `text-[17px] sm:text-[20px] leading-relaxed text-paper/85 mb-8 max-w-[40ch] mx-auto`
- CTA row: `flex flex-col sm:flex-row items-center gap-3`
  - Primary: standard primary button
  - Secondary: dark-bg ghost variant

Server component is fine (no state). Optional motion for content fade-up on viewport.

### Steps

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify** type-check + build.
- [ ] **Step 3: Commit**: `feat(fe): phase B cta-banner — full-bleed closing CTA`.

### Done criteria

- Renders 60vh at desktop, never shrinks below 480px
- Text legible against varied photo backgrounds
- TypeScript clean, build passes

---

## Task 8: Rebuild landing page (`/`)

**Goal:** Replace `fe/src/app/(client)/page.tsx` with a composition of the marketing components matching rezerv's section flow.

**File:** Replace `fe/src/app/(client)/page.tsx`.

### Composition (top to bottom)

1. **Hero** (`variant="full"`)
   - `imageKey="hero-yoga-01"`
   - `eyebrow="Lavender & Outram Park, Singapore"`
   - `headline="Find your practice in {rotating}."`
   - `rotatingWords={["yoga", "pilates", "meditation", "private training"]}`
   - `subheadline="A boutique studio with traditional group classes, specialised workshops, and one-on-one sessions across two Singapore locations."`
   - `primaryCta={{ href: "/classes", label: "Browse classes" }}`
   - `secondaryCta={{ href: "/packages", label: "View packages" }}`

2. **TrustedBy**
   - `label="Two studios, one practice"`
   - `logos=[{ name: "Breadtalk IHQ" }, { name: "Outram Park" }, { name: "200hr YTT certified" }, { name: "Reformer pilates" }, { name: "Sound healing" }]`

3. **FeatureGrid** (6 items)
   - Eyebrow: `"Everything you need"`
   - Headline: `"A complete practice, on your schedule."`
   - Items (icon names must exist in lucide-react v1.8.0 — verify; common safe choices: `Calendar`, `Sparkles`, `Users`, `Award`, `QrCode`, `Gift`):
     - `Calendar` / "Easy booking" / "Reserve with one tap from the weekly calendar."
     - `Sparkles` / "Class packages" / "Credit bundles, unlimited memberships, or drop-in."
     - `Users` / "Private sessions" / "1-on-1 or 2-on-1 with our certified instructors."
     - `Award` / "Workshops" / "Specialised deep-dives and community events."
     - `QrCode` / "QR check-in" / "A unique code per booking — no signing in at the door."
     - `Gift` / "Referral rewards" / "Earn S$20 credit when a friend joins."

4. **FeatureDeepDive** (`direction="right"`, default)
   - Eyebrow: `"Group classes"`
   - Headline: `"Book the whole week at a glance."`
   - Body: `"Our calendar makes finding your next class effortless — filter by location, level, or style and book with credits in two taps."`
   - Bullets: `["Weekly calendar view across both studios", "Real-time availability and waitlist", "Cancel up to 6 hours before with no penalty"]`
   - `imageKey="hero-pilates-01"`, `imageAlt="Weekly classes calendar"`
   - CTA: `{ href: "/classes", label: "See this week's schedule" }`

5. **FeatureDeepDive** (`direction="left"`)
   - Eyebrow: `"Credit packages"`
   - Headline: `"Pricing that fits your rhythm."`
   - Body: `"Whether you practice twice a week or every day, there's a package that matches your pace — and credits never expire mid-month."`
   - Bullets: `["Bundle credits with no expiry pressure", "Unlimited monthly with full studio access", "Family-shareable VIP packages for 2-on-1 sessions"]`
   - `imageKey="hero-meditation-01"`, `imageAlt="Class packages"`
   - CTA: `{ href: "/packages", label: "Browse packages" }`

6. **FeatureDeepDive** (`direction="right"`)
   - Eyebrow: `"Two locations"`
   - Headline: `"One membership, both studios."`
   - Body: `"Practice at Breadtalk IHQ in Lavender or Outram Park — the same package works at either, so you can book whichever fits your day."`
   - Bullets: `["Cross-location credits", "Per-location filter on the calendar", "WhatsApp the front desk for help"]`
   - `imageKey="hero-studio-01"`, `imageAlt="Studio interior"`

7. **ShowcaseGrid** (`columns={4}`)
   - Eyebrow: `"What we offer"`
   - Headline: `"Find what fits your week."`
   - Items:
     - `cat-yoga` / "Yoga" / "Traditional group classes for every level."
     - `cat-pilates` / "Pilates" / "Reformer and mat practice."
     - `cat-meditation` / "Meditation" / "Guided stillness and breath work."
     - `cat-workshop` / "Workshops" / "Limited-spot deep-dives."
   - All hrefs link to `/classes`.

8. **Testimonial** (single quote, no avatar — for prototype)
   - Quote: `"Switching to Sadhana made my practice consistent for the first time in years. The calendar is the cleanest I've used and the instructors actually remember your name."`
   - Attribution: `{ name: "Priya M.", role: "Member since 2024" }`

9. **CtaBanner**
   - `imageKey="cta-evening"`
   - Eyebrow: `"Ready when you are"`
   - Headline: `"Roll out your mat."`
   - Subheadline: `"Browse this week's classes or grab a package to get started."`
   - Primary: `{ href: "/classes", label: "Browse classes" }`
   - Secondary: `{ href: "/packages", label: "See packages" }`

The page is a server component (the marketing components handle their own client boundaries where needed). Top-level should be a simple functional component returning the section composition. No `"use client"` directive at the page level.

The "Your Credits" callout from the previous landing page is REMOVED — credit info already lives in the top nav and on `/account/packages`.

### Steps

- [ ] **Step 1: Replace** `fe/src/app/(client)/page.tsx` with the new composition.
- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run build` exit 0.
- [ ] **Step 3: Smoke test** by starting `npm run dev` and visiting `http://localhost:3000/` — confirm: hero loads with image, rotating word cycles every 3s, all sections appear in order, page scrolls to footer cleanly. Stop the dev server when done.
- [ ] **Step 4: Commit**: `feat(fe): phase B landing page — rezerv-mirror composition`.

### Done criteria

- All 9 sections render in order
- Rotating word in hero cycles smoothly
- No console errors at runtime
- TypeScript clean, build passes

---

## Task 9: Rebuild pricing page (`/pricing`)

**Goal:** Replace `fe/src/app/(client)/pricing/page.tsx` with the new visual language: hero band, tier cards, FAQ, closing CTA.

**File:** Replace `fe/src/app/(client)/pricing/page.tsx`.

### Composition

1. **Hero** (`variant="compact"`)
   - `imageKey="cta-morning"`
   - Eyebrow: `"Pricing"`
   - Headline: `"Simple, transparent pricing."` (no rotating word)
   - Subheadline: `"Choose the plan that fits your schedule. Start with a single session or commit to unlimited access."`
   - Primary: `{ href: "/classes", label: "Browse classes" }`
   - Secondary: `{ href: "#packages", label: "Jump to packages" }`

2. **Pricing tiers section** — three category groups (Drop-in / Packages / Memberships) read from `fe/src/data/products.json` using the same filter as the previous version. NEW visual treatment:
   - Section wrapper: `<section id="packages" className="py-20 sm:py-28">`
   - Container: `max-w-[1280px] mx-auto px-6 sm:px-8`
   - For each category:
     - Header: eyebrow + h2 + short description (left-aligned, mb-12)
     - Card grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
     - Each pricing card:
       - Wrapper: `bg-card border rounded-lg p-6 flex flex-col transition-all hover:shadow-hover hover:-translate-y-1`. Highlight popular cards (use `product.popular` boolean if present; otherwise the second item per category) with `border-accent ring-1 ring-accent/20 shadow-hover` instead of `border-border shadow-soft`.
       - "Most popular" badge (if popular): absolute top, terracotta pill
       - Product name: `text-[20px] font-bold text-ink`
       - Price: `text-[36px] font-extrabold text-ink leading-tight tracking-tight` + suffix (`/month` or `/session`) in `text-[14px] text-muted`
       - Bullet list of features (re-use the existing per-type bullet logic from the previous page): `space-y-2 my-6 text-[14px] text-muted`
       - CTA button: primary style, full-width via `w-full`, `mt-auto`. Label: `"Buy now"` for `package`, `"Subscribe"` for `membership`, `"Book a class"` for `drop-in`.

3. **FAQ section** — replace the current "Questions?" paragraph with a small accordion-less list:
   - Section wrapper: `<section className="py-20 sm:py-28 bg-warm">`
   - Container: `max-w-[800px] mx-auto px-6 sm:px-8`
   - h2: `"Common questions"`
   - 4–5 Q&A pairs, each: question (`text-[18px] font-bold text-ink mb-2`), answer (`text-[15px] leading-relaxed text-muted mb-6`)
   - Suggested questions (write the answers concisely):
     - "Do credits expire?" — bundle credits expire on the date shown; unused credits are forfeited.
     - "Can I share my membership?" — VIP packages are family-shareable; other plans are personal.
     - "How do cancellations work?" — Cancel up to 6 hours before class with no penalty; later cancellations forfeit the credit.
     - "Are workshops included in packages?" — Workshops require separate purchase; packages cover regular sessions only.
     - "Auto-renewal?" — Memberships auto-renew monthly and can be cancelled from your account.

4. **CtaBanner**
   - `imageKey="cta-community"`
   - Headline: `"Your first class is one tap away."`
   - Primary: `{ href: "/classes", label: "Browse this week" }`
   - Secondary: `{ href: "/login", label: "Sign in" }`

Page is a server component (or a client component if motion is wanted on the cards — match Task 8's choice).

### Steps

- [ ] **Step 1: Replace** `fe/src/app/(client)/pricing/page.tsx`.
- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run build` exit 0.
- [ ] **Step 3: Smoke test** at `http://localhost:3000/pricing`.
- [ ] **Step 4: Commit**: `feat(fe): phase B pricing page — rezerv-style tiers + FAQ + CTA`.

### Done criteria

- Hero compact variant renders
- All three pricing categories present with cards rendered from products.json
- FAQ section reads cleanly
- CTA banner closes the page
- TypeScript clean, build passes

---

## Task 10: Visual smoke verification

**Goal:** Confirm Phase B landed cleanly across landing + pricing + that Phase A pages still work.

**File:** Snapshots saved under `docs/superpowers/specs/phase-b-snapshots/`.

### Routes to capture (desktop 1440×900 + mobile 375×812)

Desktop:
- `/` → `home-desktop.png` (full page)
- `/pricing` → `pricing-desktop.png` (full page)
- `/classes` → `classes-desktop.png` (regression check — Phase B shouldn't have touched this)
- `/account` → `account-desktop.png` (regression check)

Mobile:
- `/` → `home-mobile.png` (full page)
- `/pricing` → `pricing-mobile.png` (full page)

### Acceptance criteria

For the new pages (`/` and `/pricing`):

1. ✅/❌ **Hero photo loads via `next/image`** — no broken-image icons; the cream-toned warm filter is applied.
2. ✅/❌ **Rotating word cycles** — visible in `home-desktop.png` and `home-mobile.png` (capture mid-cycle ideally, or at least confirm one rotating word is rendered).
3. ✅/❌ **All marketing components render** in landing page — TrustedBy strip visible, FeatureGrid 6 icons, three FeatureDeepDive sections (alternating image side at desktop), ShowcaseGrid with 4 photo cards, Testimonial quote, CtaBanner closing.
4. ✅/❌ **Pricing tiers populated** from products.json across three categories.
5. ✅/❌ **FAQ section visible** at `/pricing`.
6. ✅/❌ **CTA banner closes both pages** above the dark Phase A footer.

For regression (`/classes`, `/account`):

7. ✅/❌ **Phase A nav + footer unchanged** — top nav 72px, dark footer present.
8. ✅/❌ **No console errors** on any of the 4 desktop routes.

### Steps

- [ ] **Step 1: Start dev server** (`cd fe && npm run dev`) in background; wait until ready.
- [ ] **Step 2: Capture all 6 screenshots** via Playwright MCP. Save to `docs/superpowers/specs/phase-b-snapshots/`.
- [ ] **Step 3: Spot-check console** on `/`, `/pricing`, `/classes`.
- [ ] **Step 4: Evaluate criteria** against actual screenshots.
- [ ] **Step 5: File issues** to `docs/superpowers/specs/phase-b-issues.md` if any criterion fails. If all pass, skip this file.
- [ ] **Step 6: Commit + tag.**

```bash
git add docs/superpowers/specs/phase-b-snapshots/
[ -f docs/superpowers/specs/phase-b-issues.md ] && git add docs/superpowers/specs/phase-b-issues.md
git commit -m "chore(fe): phase B visual verification snapshots" --allow-empty
git tag phase-b-marketing
```

- [ ] **Step 7: Stop the dev server.** Note: if the harness blocks `pkill`, leave it running and report this — the controller will handle cleanup.

### Done criteria

- All 8 acceptance criteria evaluated (each ✅ or ❌)
- Snapshots committed
- Tag `phase-b-marketing` created

---

## Phase B Done Criteria

All ten tasks complete AND:
- 7 marketing components live in `fe/src/components/marketing/`
- Landing and pricing pages composed from those components
- `npm run build` exits 0 from `fe/`
- `phase-b-marketing` tag exists
- Visual snapshots committed
- All review issues either resolved or escalated

When all are green, hand off to Phase C planning (functional booking pages: `/classes`, `/packages`, `/workshops`, `/private-sessions`, `/booking/confirmation`, `/checkout`).

---

## Notes for the Controller

- **Stitch MCP is available** — for the Hero, FeatureDeepDive, and ShowcaseGrid tasks (the most visually high-stakes), the implementer can call `mcp__stitch__generate_screen_from_text` with a prompt referencing rezerv.co and the design tokens to get a Gemini-generated mockup BEFORE coding the React component. Useful for catching design issues early; not required.
- **Frontend-design skill is also available** — alternative to Stitch. Use whichever the implementer is comfortable with.
- **Worktree:** branch `redesign/phase-b-marketing` is the workspace; do not switch branches.
- **Rollback:** if a marketing component lands wrong, `git revert <sha>` is safer than fixing in place. Each component is a single commit.
