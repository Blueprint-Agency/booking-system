# Frontend Redesign — Phase A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the existing 25-route Next.js client portal with a rezerv.co-inspired visual foundation — new design tokens (Manrope-only typography, recalibrated colors, lighter shadows), restructured top nav, new site footer, and a curated photography manifest — so subsequent phases (B/C/D) can build on a consistent base.

**Architecture:** Pure visual + structural changes to `fe/`. No PRD changes, no new routes, no backend. Token changes propagate via Tailwind v4's `@theme` block in `globals.css`. New components are added under `fe/src/components/layout/` and `fe/src/components/marketing/` (the marketing namespace is created here even though Phase A doesn't populate it — it'll house Phase B's hero/grid/etc components). Photography is referenced through a single manifest at `fe/src/data/images.ts` so Phase B can swap or extend without scattered imports.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 (no `tailwind.config` — `@theme` inline in `globals.css`) · TypeScript · framer-motion (already installed) · lucide-react (already installed). No test framework currently installed in `fe/` — Phase A uses **build-pass + Playwright MCP visual verification** as the test layer rather than introducing Jest/Vitest just for styling changes (YAGNI).

**Reference spec:** `docs/superpowers/specs/2026-04-18-frontend-redesign-design.md`

**Out of scope for Phase A** (covered by later phase plans):
- Marketing page rebuilds (Phase B)
- Functional page restyles (Phase C)
- Account + auth restyles (Phase D)
- Component-level unit tests
- Real client photography

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `fe/src/app/globals.css` | Modify | Replace `@theme` token block with Phase A tokens; add `.photo-warm` utility |
| `fe/src/app/layout.tsx` | Modify | Swap Google Fonts link to Manrope only |
| `fe/src/components/layout/client-nav.tsx` | Replace | New nav structure: logo / center links / sign-in + CTA. Existing credit-pill UX preserved |
| `fe/src/components/layout/site-footer.tsx` | Create | 4-column dark footer (Brand / Studio / Legal / Contact) |
| `fe/src/app/(client)/layout.tsx` | Modify | Mount `<SiteFooter />` after `<main>` |
| `fe/src/data/images.ts` | Create | Manifest for the 15-image curated Unsplash set + placeholder slot definitions |
| `fe/public/images/.gitkeep` | Create | Reserve folder; actual JPGs are downloaded in Task A3 |
| `fe/src/components/marketing/.gitkeep` | Create | Reserve folder for Phase B components |

---

## Task 1: Update design tokens in `globals.css`

**Files:**
- Modify: `fe/src/app/globals.css`

- [ ] **Step 1: Open the current file and replace the entire `@theme` block + base layer**

Replace the whole file with this content:

```css
@import "tailwindcss";

@theme {
  /* Typography — single family for Phase A */
  --font-sans: "Manrope", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Neutral foundation */
  --color-paper: #faf9f6;
  --color-warm: #f5f0e8;
  --color-card: #ffffff;
  --color-inverse: #ffffff;
  --color-border: #ece8e0;
  --color-ink: #1f1d1a;
  --color-muted: #6b6862;

  /* Primary accent — terracotta */
  --color-accent: #c4956a;
  --color-accent-deep: #a67548;

  /* Semantic status */
  --color-sage: #7a8f72;
  --color-warning: #d4a843;
  --color-error: #c45a5a;

  /* Photo overlay for hero legibility */
  --color-overlay: rgba(31, 29, 26, 0.45);

  /* Radius — tighter than before */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  /* Shadow — lighter, more layered */
  --shadow-soft: 0 1px 3px rgba(31, 29, 26, 0.06), 0 8px 24px rgba(31, 29, 26, 0.04);
  --shadow-hover: 0 4px 12px rgba(31, 29, 26, 0.08), 0 16px 40px rgba(31, 29, 26, 0.06);
  --shadow-modal: 0 16px 64px rgba(31, 29, 26, 0.18);
}

@layer base {
  html {
    scroll-behavior: smooth;
  }

  body {
    font-family: var(--font-sans);
    background: var(--color-paper);
    color: var(--color-ink);
    line-height: 1.6;
    font-weight: 400;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  h1, h2, h3, h4 {
    font-family: var(--font-sans);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  h3, h4 {
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  *:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
}

/* Photography treatment — warm tonal bias for consistent imagery */
.photo-warm {
  filter: sepia(0.05) saturate(1.05) contrast(1.02);
}

/* Hero overlay — apply on a child of a relative parent containing an image */
.photo-overlay::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--color-overlay);
  pointer-events: none;
}

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-fade-up {
  animation: fadeUp 0.4s ease-out both;
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out both;
}

.stagger-1 { animation-delay: 0.06s; }
.stagger-2 { animation-delay: 0.12s; }
.stagger-3 { animation-delay: 0.18s; }
.stagger-4 { animation-delay: 0.24s; }
.stagger-5 { animation-delay: 0.30s; }
.stagger-6 { animation-delay: 0.36s; }
```

- [ ] **Step 2: Verify build does not regress**

From `fe/`, run:

```bash
npm run build
```

Expected: build completes with **zero errors**. Tailwind v4 will pick up the new `@theme` automatically — class names like `bg-accent`, `text-ink`, `border-border` continue to work.

If the build errors with `Unknown utility class`, the change broke a token name. Check that every token previously consumed by Tailwind classes (search the codebase for `bg-paper`, `bg-warm`, `bg-card`, `bg-accent`, `bg-accent-deep`, `bg-sage`, `bg-warning`, `bg-error`, `text-ink`, `text-muted`, `text-inverse`, `border-border`, `font-serif`, `font-sans`, `font-mono`) is still defined or has been intentionally removed. The notable removal in this step: **`--font-serif` no longer exists**. If anything imports `font-serif` it will silently fall back to default — that's acceptable for Phase A; we'll catch and replace those usages in Task 4 (nav) and the Phase B/C plans.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/globals.css
git commit -m "feat(fe): phase A tokens — Manrope + lighter shadows + photo utilities"
```

---

## Task 2: Swap fonts in root layout

**Files:**
- Modify: `fe/src/app/layout.tsx`

- [ ] **Step 1: Replace the `<head>` font link**

In `fe/src/app/layout.tsx`, find the existing `<link>` tag that loads `DM+Serif+Display`, `Outfit`, and `JetBrains+Mono`. Replace just that one `<link>` with:

```tsx
<link
  href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

The two `<link rel="preconnect">` lines above it stay unchanged.

- [ ] **Step 2: Restart dev server and verify font loads**

From `fe/`, run:

```bash
npm run dev
```

Open `http://localhost:3000/` in the browser. Open DevTools → Network → filter "fonts" — confirm only `manrope-*.woff2` and `jetbrains-mono-*.woff2` files load. Confirm DM Serif Display and Outfit do NOT load.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/layout.tsx
git commit -m "feat(fe): phase A typography — load Manrope only"
```

---

## Task 3: Photography manifest + folder scaffold

**Files:**
- Create: `fe/src/data/images.ts`
- Create: `fe/public/images/.gitkeep`
- Create: `docs/superpowers/specs/photo-todo.md`

- [ ] **Step 1: Create the public folder placeholder**

```bash
mkdir -p fe/public/images
touch fe/public/images/.gitkeep
```

- [ ] **Step 2: Create the image manifest**

Write `fe/src/data/images.ts`:

```typescript
/**
 * Phase A image manifest. Curated 15-image Unsplash set for the prototype
 * + slots reserved for client-supplied photography (Yoga Sadhana studios,
 * instructors). All Unsplash URLs use the public CDN with width hints;
 * no API key required.
 *
 * Each entry pairs a stable key with both a Unsplash CDN URL (used now)
 * and a local-asset path (used once images are downloaded into
 * /public/images/). Phase B components import from this manifest only.
 */

export type ImageEntry = {
  key: string;
  alt: string;
  /** Unsplash hosted URL for prototype use. */
  unsplash: string;
  /** Local path under /public once asset is downloaded. */
  local: string;
  /** Tag for filtering by section purpose. */
  category: "hero" | "category" | "cta" | "auth" | "studio" | "instructor";
};

export const IMAGES: ImageEntry[] = [
  // Hero-grade lifestyle (4)
  { key: "hero-yoga-01",     alt: "Woman in seated meditation pose at sunrise",        unsplash: "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=1920&q=80", local: "/images/hero-yoga-01.jpg",     category: "hero" },
  { key: "hero-pilates-01",  alt: "Pilates class in a bright studio",                  unsplash: "https://images.unsplash.com/photo-1599058917765-a780eda07a3e?w=1920&q=80", local: "/images/hero-pilates-01.jpg",  category: "hero" },
  { key: "hero-studio-01",   alt: "Quiet yoga studio interior with mats laid out",     unsplash: "https://images.unsplash.com/photo-1591291621164-2c6367723315?w=1920&q=80", local: "/images/hero-studio-01.jpg",   category: "hero" },
  { key: "hero-meditation-01", alt: "Group meditation in soft natural light",          unsplash: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1920&q=80", local: "/images/hero-meditation-01.jpg", category: "hero" },

  // Category showcase (4)
  { key: "cat-yoga",         alt: "Yoga warrior pose",                                 unsplash: "https://images.unsplash.com/photo-1575052814086-f385e2e2ad1b?w=1200&q=80", local: "/images/cat-yoga.jpg",         category: "category" },
  { key: "cat-pilates",      alt: "Pilates reformer practice",                         unsplash: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&q=80", local: "/images/cat-pilates.jpg",      category: "category" },
  { key: "cat-meditation",   alt: "Lit candle and meditation cushion",                 unsplash: "https://images.unsplash.com/photo-1593811167562-9cef47bfc4d7?w=1200&q=80", local: "/images/cat-meditation.jpg",   category: "category" },
  { key: "cat-workshop",     alt: "Small group workshop in a studio",                  unsplash: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1200&q=80", local: "/images/cat-workshop.jpg",     category: "category" },

  // CTA banners (4)
  { key: "cta-evening",      alt: "Sunset over a peaceful studio window",              unsplash: "https://images.unsplash.com/photo-1532798442725-41036acc7489?w=1920&q=80", local: "/images/cta-evening.jpg",      category: "cta" },
  { key: "cta-morning",      alt: "Morning yoga mat by a window",                      unsplash: "https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=1920&q=80", local: "/images/cta-morning.jpg",      category: "cta" },
  { key: "cta-community",    alt: "Group of practitioners after class",                unsplash: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1920&q=80", local: "/images/cta-community.jpg",    category: "cta" },
  { key: "cta-quiet",        alt: "Empty studio with soft lighting",                   unsplash: "https://images.unsplash.com/photo-1611072337755-2d1da7c91b8b?w=1920&q=80", local: "/images/cta-quiet.jpg",        category: "cta" },

  // Auth split-screen (3)
  { key: "auth-calm-01",     alt: "Hands resting on knees in meditation",              unsplash: "https://images.unsplash.com/photo-1474418397713-7ede21d49118?w=1200&q=80", local: "/images/auth-calm-01.jpg",     category: "auth" },
  { key: "auth-calm-02",     alt: "Soft natural light through studio window",          unsplash: "https://images.unsplash.com/photo-1545389336-cf090694435e?w=1200&q=80", local: "/images/auth-calm-02.jpg",     category: "auth" },
  { key: "auth-calm-03",     alt: "Plant and yoga mat detail",                         unsplash: "https://images.unsplash.com/photo-1599447421416-3414500d18a5?w=1200&q=80", local: "/images/auth-calm-03.jpg",     category: "auth" },
];

/**
 * Placeholder slots — to be filled with client-supplied photography.
 * Each slot has an Unsplash fallback so the prototype renders today.
 */
export const PLACEHOLDER_SLOTS = {
  studioCover: { fallback: "hero-studio-01", note: "Yoga Sadhana studio cover image (replace with actual Breadtalk IHQ shot)" },
  studioInteriorBreadtalk: { fallback: "hero-studio-01", note: "Breadtalk IHQ studio interior" },
  studioInteriorOutram: { fallback: "hero-yoga-01", note: "Outram Park studio interior" },
  instructorPlaceholder: { fallback: "cat-meditation", note: "Yoga Sadhana instructor headshots (4 needed)" },
} as const;

/** Helper: get image by key. Throws if unknown. */
export function img(key: string): ImageEntry {
  const found = IMAGES.find((i) => i.key === key);
  if (!found) throw new Error(`Unknown image key: ${key}`);
  return found;
}

/** Helper: filter by category. */
export function imgsByCategory(category: ImageEntry["category"]): ImageEntry[] {
  return IMAGES.filter((i) => i.category === category);
}
```

- [ ] **Step 3: Verify the manifest type-checks**

From `fe/`, run:

```bash
npx tsc --noEmit
```

Expected: zero errors. (If existing files have unrelated type errors, they're not introduced by this task — note them but proceed.)

- [ ] **Step 4: Create the photo TODO doc**

Write `docs/superpowers/specs/photo-todo.md`:

```markdown
# Photography TODO — Client-supplied assets needed

Generated by Phase A (2026-04-18). Each item below is a slot currently filled with a Unsplash fallback. Replace with real Yoga Sadhana photography when the client provides it.

| Slot key | Used on | Fallback (Unsplash key) | What to deliver |
|---|---|---|---|
| `studioCover` | Future studio profile page | `hero-studio-01` | One landscape (16:9) cover image of either studio, ≥ 1920px wide |
| `studioInteriorBreadtalk` | Phase B landing showcase | `hero-studio-01` | Interior shot of Breadtalk IHQ studio, landscape, ≥ 1600px wide |
| `studioInteriorOutram` | Phase B landing showcase | `hero-yoga-01` | Interior shot of Outram Park studio, landscape, ≥ 1600px wide |
| `instructorPlaceholder` × 4 | Phase C `/private-sessions` instructor cards | `cat-meditation` | 4 instructor headshots, square (1:1), ≥ 800px |

Once delivered, drop files into `fe/public/images/`, update keys in `fe/src/data/images.ts`, and grep for `PLACEHOLDER_SLOTS` to find any remaining usages.
```

- [ ] **Step 5: Commit**

```bash
git add fe/src/data/images.ts fe/public/images/.gitkeep docs/superpowers/specs/photo-todo.md
git commit -m "feat(fe): phase A image manifest + placeholder slot doc"
```

---

## Task 4: Rewrite `ClientNav` for the new visual language

**Files:**
- Modify: `fe/src/components/layout/client-nav.tsx`

The existing nav is functionally rich (credit pill, dropdown with PT credits, mobile drawer). We **preserve all of that behavior** — only typography, spacing, accent usage, and the wordmark change. The previous file used `font-serif` (DM Serif Display) for the wordmark; that font no longer exists.

- [ ] **Step 1: Replace the file with the updated version**

Write `fe/src/components/layout/client-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";

const NAV_LINKS = [
  { href: "/classes", label: "Classes" },
  { href: "/workshops", label: "Workshops" },
  { href: "/private-sessions", label: "Private Sessions" },
  { href: "/packages", label: "Packages" },
];

export function ClientNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isAuth = true; // Mock: always authenticated for prototype
  const isHome = pathname === "/";

  useEffect(() => {
    if (!isHome) {
      setScrolled(false);
      return;
    }
    const handleScroll = () => setScrolled(window.scrollY > 40);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHome]);

  const isTransparent = isHome && !scrolled;

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        isTransparent
          ? "bg-transparent"
          : "bg-paper/95 backdrop-blur-sm border-b border-border"
      )}
    >
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        <div className="flex items-center justify-between h-[72px]">
          {/* Logo — Manrope wordmark, bolder */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center">
              <span className="text-inverse font-extrabold text-base">Y</span>
            </div>
            <span className="font-extrabold tracking-tight text-[18px] text-ink">
              Yoga Sadhana
            </span>
          </Link>

          {/* Desktop center nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3.5 py-2 text-[14px] font-semibold rounded-md transition-colors duration-200",
                  isActive(href)
                    ? "text-accent-deep bg-accent/10"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {label}
              </Link>
            ))}
            {isAuth && (
              <Link
                href="/account"
                className={cn(
                  "px-3.5 py-2 text-[14px] font-semibold rounded-md transition-colors duration-200",
                  isActive("/account")
                    ? "text-accent-deep bg-accent/10"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                My Bookings
              </Link>
            )}
          </nav>

          {/* Right side — credit pill + avatar dropdown OR sign-in CTA */}
          <div className="hidden md:flex items-center gap-3">
            {isAuth ? (
              <div className="relative group">
                <button className="flex items-center gap-2.5" aria-label="Account menu">
                  <Link
                    href="/account/packages"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-sage/10 border border-sage/20 hover:border-sage/40 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                    <span className="text-[12px] font-bold text-sage">{MOCK_USER.classCredits}</span>
                    <span className="text-[10px] font-medium text-muted">credits</span>
                  </Link>
                  <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-[12px] font-bold text-accent-deep group-hover:bg-accent group-hover:text-inverse transition-colors duration-200">
                    {MOCK_USER.initials}
                  </div>
                </button>
                <div className="absolute right-0 top-full mt-2 w-60 bg-card border border-border rounded-md shadow-hover opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 py-1">
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-semibold text-ink">Class Credits</span>
                      <span className="text-[12px] font-bold text-sage">{MOCK_USER.classCredits} left</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sage transition-all"
                        style={{ width: `${(MOCK_USER.classCredits / MOCK_USER.classPackageTotal) * 100}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted mt-1">
                      {MOCK_USER.classPackageName} · expires{" "}
                      {new Date(MOCK_USER.classPackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                    </p>
                    {MOCK_USER.pt1on1Credits > 0 && (
                      <>
                        <div className="flex items-center justify-between mt-3 mb-1.5">
                          <span className="text-[12px] font-semibold text-ink">PT Credits (1-on-1)</span>
                          <span className="text-[12px] font-bold text-accent-deep">{MOCK_USER.pt1on1Credits} left</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${(MOCK_USER.pt1on1Credits / MOCK_USER.pt1on1PackageTotal) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted mt-1">
                          {MOCK_USER.pt1on1PackageName} · expires{" "}
                          {new Date(MOCK_USER.pt1on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                        </p>
                      </>
                    )}
                    {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageName && MOCK_USER.pt2on1PackageExpiry && (
                      <>
                        <div className="flex items-center justify-between mt-3 mb-1.5">
                          <span className="text-[12px] font-semibold text-ink">PT Credits (2-on-1)</span>
                          <span className="text-[12px] font-bold text-warning">{MOCK_USER.pt2on1Credits} left</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-warm overflow-hidden">
                          <div
                            className="h-full rounded-full bg-warning transition-all"
                            style={{ width: `${(MOCK_USER.pt2on1Credits / MOCK_USER.pt2on1PackageTotal) * 100}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted mt-1">
                          {MOCK_USER.pt2on1PackageName} · expires{" "}
                          {new Date(MOCK_USER.pt2on1PackageExpiry).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                        </p>
                      </>
                    )}
                  </div>
                  <Link href="/account" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                    My Bookings
                  </Link>
                  <Link href="/account/packages" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                    My Packages
                  </Link>
                  <Link href="/account/qr" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                    My QR Code
                  </Link>
                  <Link href="/account/profile" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">
                    Profile
                  </Link>
                  <div className="border-t border-border my-1" />
                  <Link href="/login" className="block px-4 py-2 text-[13px] font-medium text-error hover:bg-error/10 transition-colors">
                    Log out
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <Link href="/login" className="px-4 py-2 text-[14px] font-semibold text-ink hover:text-accent-deep transition-colors">
                  Sign in
                </Link>
                <Link
                  href="/classes"
                  className="px-5 py-2.5 text-[14px] font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200"
                >
                  Book a class
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-md hover:bg-warm transition-colors"
            aria-label="Toggle menu"
          >
            <div className="w-5 flex flex-col gap-1">
              <span className={cn("block h-0.5 bg-ink transition-transform duration-200", mobileOpen && "rotate-45 translate-y-1.5")} />
              <span className={cn("block h-0.5 bg-ink transition-opacity duration-200", mobileOpen && "opacity-0")} />
              <span className={cn("block h-0.5 bg-ink transition-transform duration-200", mobileOpen && "-rotate-45 -translate-y-1.5")} />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-paper animate-fade-in">
          <nav className="flex flex-col p-4 gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2.5 text-[14px] font-semibold rounded-md transition-colors",
                  isActive(href)
                    ? "text-accent-deep bg-accent/10"
                    : "text-muted hover:text-ink hover:bg-warm"
                )}
              >
                {label}
              </Link>
            ))}
            {isAuth ? (
              <>
                <div className="mx-3 my-2 p-3 rounded-md bg-sage/10 border border-sage/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                      <span className="text-[12px] font-bold text-sage">{MOCK_USER.classCredits} class credits</span>
                    </div>
                    <span className="text-[10px] text-muted">{MOCK_USER.classPackageName}</span>
                  </div>
                  {MOCK_USER.pt1on1Credits > 0 && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-deep" />
                        <span className="text-[12px] font-bold text-accent-deep">{MOCK_USER.pt1on1Credits} PT (1-on-1)</span>
                      </div>
                      <span className="text-[10px] text-muted">{MOCK_USER.pt1on1PackageName}</span>
                    </div>
                  )}
                  {MOCK_USER.pt2on1Credits > 0 && MOCK_USER.pt2on1PackageName && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                        <span className="text-[12px] font-bold text-warning">{MOCK_USER.pt2on1Credits} PT (2-on-1)</span>
                      </div>
                      <span className="text-[10px] text-muted">{MOCK_USER.pt2on1PackageName}</span>
                    </div>
                  )}
                  <Link href="/account/packages" onClick={() => setMobileOpen(false)} className="block text-[11px] text-accent font-semibold mt-2 hover:text-accent-deep transition-colors">
                    View all packages →
                  </Link>
                </div>
                <div className="border-t border-border my-2" />
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "px-3 py-2.5 text-[14px] font-semibold rounded-md transition-colors",
                    isActive("/account") ? "text-accent-deep bg-accent/10" : "text-muted hover:text-ink hover:bg-warm"
                  )}
                >
                  My Account
                </Link>
                <Link href="/login" onClick={() => setMobileOpen(false)} className="px-3 py-2.5 text-[14px] font-semibold rounded-md text-error hover:bg-error/10 transition-colors">
                  Log out
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2.5 text-[14px] font-bold rounded-md bg-accent text-inverse hover:bg-accent-deep transition-colors"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
```

Key changes from previous version (so reviewers can scan the diff):
- `font-serif` → `font-extrabold tracking-tight` for the wordmark (DM Serif no longer loaded)
- Container width: `max-w-6xl` → `max-w-[1280px]`, gutters `px-4 sm:px-6` → `px-6 sm:px-8`
- Nav row height: `h-16` → `h-[72px]`
- Logo block: `w-8 h-8 rounded-lg` → `w-9 h-9 rounded-md`, font weight bumped
- Link weights: `font-medium` → `font-semibold`, sizes pinned to `[14px]`
- Active state opacity: `bg-accent/15` → `bg-accent/10` (subtler)
- Avatar: bigger (`w-9 h-9`), bolder text
- Sign-in case (when `isAuth = false`) gets the new dual CTA: ghost "Sign in" + bold terracotta "Book a class"
- All radii reduced from `rounded-lg` → `rounded-md` to match new `--radius-md` token

- [ ] **Step 2: Type-check and visually verify**

```bash
cd fe && npx tsc --noEmit && npm run dev
```

In browser: visit `/` (transparent nav over hero), `/classes` (solid nav with border), and resize to mobile width to confirm the hamburger drawer still works. Confirm the "Y" wordmark renders in Manrope (not the now-missing DM Serif).

- [ ] **Step 3: Commit**

```bash
git add fe/src/components/layout/client-nav.tsx
git commit -m "feat(fe): phase A nav — Manrope wordmark, tighter radii, new CTAs"
```

---

## Task 5: Create `SiteFooter` component

**Files:**
- Create: `fe/src/components/layout/site-footer.tsx`

- [ ] **Step 1: Write the component**

```tsx
import Link from "next/link";
import { Instagram, Facebook, Mail, MessageCircle } from "lucide-react";

const STUDIO_LOCATIONS = [
  { name: "Breadtalk IHQ (Lavender)", address: "30 Tai Seng Street, Singapore" },
  { name: "Outram Park", address: "10 Outram Park, Singapore" },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Refund Policy" },
];

const QUICK_LINKS = [
  { href: "/classes", label: "Classes" },
  { href: "/workshops", label: "Workshops" },
  { href: "/private-sessions", label: "Private Sessions" },
  { href: "/packages", label: "Packages" },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-paper mt-24">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center">
                <span className="text-inverse font-extrabold text-base">Y</span>
              </div>
              <span className="font-extrabold tracking-tight text-[18px] text-paper">
                Yoga Sadhana
              </span>
            </Link>
            <p className="text-[14px] leading-relaxed text-paper/70 max-w-[28ch]">
              A boutique yoga studio in Singapore — group classes, private sessions, and workshops across two locations.
            </p>
          </div>

          {/* Studios */}
          <div>
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-paper/50 mb-4">
              Our Studios
            </h4>
            <ul className="space-y-3">
              {STUDIO_LOCATIONS.map((loc) => (
                <li key={loc.name} className="text-[14px] leading-relaxed">
                  <p className="font-semibold text-paper">{loc.name}</p>
                  <p className="text-paper/60">{loc.address}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-paper/50 mb-4">
              Book
            </h4>
            <ul className="space-y-2">
              {QUICK_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[14px] text-paper/70 hover:text-paper transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-paper/50 mb-4">
              Get in touch
            </h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://wa.me/6591234567"
                  className="inline-flex items-center gap-2 text-[14px] text-paper/70 hover:text-paper transition-colors"
                >
                  <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
                  WhatsApp us
                </a>
              </li>
              <li>
                <a
                  href="mailto:hello@yogasadhana.sg"
                  className="inline-flex items-center gap-2 text-[14px] text-paper/70 hover:text-paper transition-colors"
                >
                  <Mail className="w-4 h-4" strokeWidth={1.5} />
                  hello@yogasadhana.sg
                </a>
              </li>
            </ul>
            <div className="flex items-center gap-3 mt-5">
              <a
                href="https://instagram.com/yogasadhana"
                aria-label="Instagram"
                className="w-9 h-9 rounded-md bg-paper/5 hover:bg-paper/10 flex items-center justify-center transition-colors"
              >
                <Instagram className="w-4 h-4" strokeWidth={1.5} />
              </a>
              <a
                href="https://facebook.com/yogasadhana"
                aria-label="Facebook"
                className="w-9 h-9 rounded-md bg-paper/5 hover:bg-paper/10 flex items-center justify-center transition-colors"
              >
                <Facebook className="w-4 h-4" strokeWidth={1.5} />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-paper/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="text-[12px] text-paper/50">
            © {new Date().getFullYear()} Yoga Sadhana. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="text-[12px] text-paper/50 hover:text-paper transition-colors"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe && npx tsc --noEmit
```

Expected: zero errors. The footer references icons (`Instagram`, `Facebook`, `Mail`, `MessageCircle`) from `lucide-react` (already installed per `package.json`).

- [ ] **Step 3: Commit**

```bash
git add fe/src/components/layout/site-footer.tsx
git commit -m "feat(fe): phase A site footer — 4-column dark layout"
```

---

## Task 6: Mount `SiteFooter` in client layout

**Files:**
- Modify: `fe/src/app/(client)/layout.tsx`

- [ ] **Step 1: Replace the layout file**

Write `fe/src/app/(client)/layout.tsx`:

```tsx
import { ClientNav } from "@/components/layout/client-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { RoleSwitcher } from "@/components/layout/role-switcher";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <ClientNav />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <RoleSwitcher />
    </div>
  );
}
```

- [ ] **Step 2: Verify the footer renders on every client route**

From `fe/`, with the dev server running, visit:
- `/` (landing)
- `/classes`
- `/packages`
- `/account`
- `/login`

Expected: each page now ends with the dark 4-column footer. No layout breaks above it.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/(client)/layout.tsx
git commit -m "feat(fe): phase A — mount SiteFooter in client layout"
```

---

## Task 7: Reserve marketing-component folder for Phase B

**Files:**
- Create: `fe/src/components/marketing/.gitkeep`

- [ ] **Step 1: Create the folder placeholder**

```bash
mkdir -p fe/src/components/marketing
touch fe/src/components/marketing/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add fe/src/components/marketing/.gitkeep
git commit -m "chore(fe): reserve marketing/ component folder for phase B"
```

---

## Task 8: Visual smoke verification across all routes

**Files:** none modified — pure verification.

- [ ] **Step 1: Start the dev server**

```bash
cd fe && npm run dev
```

Wait for `✓ Ready in <ms>`.

- [ ] **Step 2: Use Playwright MCP to screenshot every route**

Using `mcp__plugin_playwright_playwright__browser_navigate` followed by `mcp__plugin_playwright_playwright__browser_take_screenshot`, capture each route at desktop width (1440×900) and mobile width (375×812):

Routes to capture (24 total):
- `/` — landing
- `/classes`
- `/workshops`
- `/private-sessions`
- `/packages`
- `/pricing`
- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/verify-email`
- `/waiver`
- `/checkout`
- `/booking/confirmation`
- `/account`
- `/account/history`
- `/account/invoices`
- `/account/membership`
- `/account/packages`
- `/account/profile`
- `/account/qr`
- `/account/referral`
- `/private-sessions/[id]` (use any sample id from fixtures)
- `/workshops/[id]` (use any sample id from fixtures)

Save screenshots into `docs/superpowers/specs/phase-a-snapshots/` (create the folder).

- [ ] **Step 3: Review the screenshots against the acceptance criteria**

Scan each screenshot. Confirm:

1. ✅ Body type renders in Manrope (not Outfit), no fallback serif anywhere
2. ✅ Top nav has the new wordmark (no DM Serif), 72px tall, 1280px content width
3. ✅ Footer renders dark on every page, with 4 columns on desktop, stacked on mobile
4. ✅ Buttons use `rounded-md` (6px), not the previous `rounded-lg`
5. ✅ No console errors in dev tools
6. ✅ Credit pill in top nav still works on `/`, `/classes`, etc.
7. ✅ Mobile hamburger drawer opens and credit summary shows in mobile view

If any item fails, capture the broken page in `docs/superpowers/specs/phase-a-issues.md` with the path and a one-line description, then fix it before completing this task.

- [ ] **Step 4: Tag and commit verification artifacts**

```bash
git add docs/superpowers/specs/phase-a-snapshots/ docs/superpowers/specs/phase-a-issues.md 2>/dev/null || true
git commit -m "chore(fe): phase A visual verification snapshots" --allow-empty
git tag phase-a-foundation
```

The `--allow-empty` is in case you didn't need to file any issues — the tag is the real artifact, marking the foundation as ready for Phase B.

---

## Phase A Done Criteria

All boxes ticked AND the following hold true:

- [x] `npm run build` exits 0
- [x] `npx tsc --noEmit` exits 0
- [x] No DM Serif Display or Outfit font request in browser Network tab
- [x] `phase-a-foundation` git tag created
- [x] Footer visible on every client route
- [x] All 8 commits land on the branch in order

When all are green, hand off to Phase B planning. Phase B will (a) build the 7 marketing components in `fe/src/components/marketing/`, then (b) rebuild `/` and `/pricing` to mirror rezerv's section flow.
