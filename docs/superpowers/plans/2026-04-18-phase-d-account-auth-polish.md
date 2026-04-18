# Frontend Redesign — Phase D: Account, Auth & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the remaining nine account routes (`/account` + 7 sub-pages) and six auth routes (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/waiver`) with the Phase A/B/C visual language, then add empty states, loading skeletons, and a full mobile responsive pass so every route in the app is visually consistent.

**Architecture:** Two structural shells do the heavy lifting and unify the routes. (1) An `AccountShell` wraps every `/account/*` route with a redesigned sidebar (Manrope typography, accent active-state, photo avatar at top) and a main content area. (2) An `AuthSplitShell` provides the rezerv-style two-panel auth layout (photo panel on one side, form panel on the other) shared across all six auth routes. Empty-states and skeletons are introduced as two small primitives (`empty-state.tsx`, `skeleton.tsx`) used across existing list and detail pages. The mobile pass is a focused audit commit — not a re-write — tightening overflow and stacking behaviors uncovered during Playwright runs.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 (`@theme` in `globals.css`) · TypeScript · framer-motion · lucide-react · `next/image`.

**Reference spec:** `docs/superpowers/specs/2026-04-18-frontend-redesign-design.md` — §5.3 (account), §5.4 (auth), §7 (component library updates).

**Out of scope for Phase D:**
- Any data shape change in `fe/src/data/`
- Any new route
- Any copy rewrite beyond small heading adjustments
- Dark mode, i18n, admin tools (spec §10)

---

## Working Conventions

- **Branch:** `redesign/phase-d-polish`, created from `redesign/phase-c-booking`.
- **Verification per task:** `cd fe && npx tsc --noEmit && npm run build` both exit 0, plus a browser smoke-check.
- **Reuse Phase C primitives:** `<SectionHeading>` and `<BookingSurface>` (from `fe/src/components/booking/`). Account pages lean on these heavily.
- **No behavior changes:** state logic, form submissions, and data imports all survive.
- **Commit cadence:** one commit per task. Messages: `feat(fe): phase D …` / `chore(fe): phase D …`.

---

## File Map

**Create:**
- `fe/src/components/account/account-shell.tsx` (Task 1)
- `fe/src/components/account/account-header.tsx` (Task 1)
- `fe/src/components/auth/auth-split-shell.tsx` (Task 10)
- `fe/src/components/ui/empty-state.tsx` (Task 17)
- `fe/src/components/ui/skeleton.tsx` (Task 17)

**Modify (full JSX rewrite, preserving state + data):**
- `fe/src/app/(client)/account/layout.tsx` (Task 1)
- `fe/src/app/(client)/account/page.tsx` (Task 2)
- `fe/src/app/(client)/account/profile/page.tsx` (Task 3)
- `fe/src/app/(client)/account/history/page.tsx` (Task 4)
- `fe/src/app/(client)/account/invoices/page.tsx` (Task 5)
- `fe/src/app/(client)/account/membership/page.tsx` (Task 6)
- `fe/src/app/(client)/account/packages/page.tsx` (Task 7)
- `fe/src/app/(client)/account/qr/page.tsx` (Task 8)
- `fe/src/app/(client)/account/referral/page.tsx` (Task 9)
- `fe/src/app/(client)/login/page.tsx` (Task 11)
- `fe/src/app/(client)/register/page.tsx` (Task 12)
- `fe/src/app/(client)/forgot-password/page.tsx` (Task 13)
- `fe/src/app/(client)/reset-password/page.tsx` (Task 14)
- `fe/src/app/(client)/verify-email/page.tsx` (Task 15)
- `fe/src/app/(client)/waiver/page.tsx` (Task 16)

**Create (verification output):**
- `docs/superpowers/specs/phase-d-snapshots/*.png` (Task 19)

---

## Task 1: `AccountShell` — redesigned sidebar layout

**Goal:** Replace the current `account/layout.tsx` internals with a new shell that renders a warm sidebar (photo avatar at top, 8 nav items, subtle divider) and a content area. The shell uses the Phase A dark footer already mounted in the outer `(client)/layout.tsx` — no change there.

**Files:**
- Create: `fe/src/components/account/account-header.tsx`
- Create: `fe/src/components/account/account-shell.tsx`
- Modify: `fe/src/app/(client)/account/layout.tsx`

### Sidebar contract

- Avatar block at top: circular `h-16 w-16 rounded-full bg-accent/20` containing initials (fallback) or photo; user name below (`text-sm font-semibold`), email (`text-xs text-muted`).
- Nav items (in order): Overview (`/account`), History (`/account/history`), Packages (`/account/packages`), Membership (`/account/membership`), Referral (`/account/referral`), Invoices (`/account/invoices`), Profile (`/account/profile`), My QR (`/account/qr`).
- Each item: `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors`. Active: `bg-ink text-paper`. Inactive: `text-muted hover:bg-warm hover:text-ink`. Leading icon from lucide.
- Sign-out button at bottom of sidebar: same visual but with `Power` icon, text "Sign out", `text-error hover:bg-error/10`.

### Steps

- [ ] **Step 1: Create `fe/src/components/account/account-header.tsx`**

```tsx
import { mockUser } from "@/data/mock-user";

export function AccountHeader() {
  const initials = mockUser.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="px-4 pb-6 border-b border-ink/10">
      <div className="h-16 w-16 rounded-full bg-accent/20 flex items-center justify-center text-lg font-semibold text-accent-deep">
        {initials}
      </div>
      <div className="mt-4">
        <div className="text-sm font-semibold text-ink">{mockUser.name}</div>
        <div className="text-xs text-muted mt-0.5">{mockUser.email}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `fe/src/components/account/account-shell.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  History,
  Package,
  Crown,
  Share2,
  Receipt,
  UserCircle,
  QrCode,
  Power,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountHeader } from "./account-header";

const navItems = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/history", label: "History", icon: History },
  { href: "/account/packages", label: "Packages", icon: Package },
  { href: "/account/membership", label: "Membership", icon: Crown },
  { href: "/account/referral", label: "Referral", icon: Share2 },
  { href: "/account/invoices", label: "Invoices", icon: Receipt },
  { href: "/account/profile", label: "Profile", icon: UserCircle },
  { href: "/account/qr", label: "My QR", icon: QrCode },
];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="bg-warm min-h-[calc(100vh-72px-320px)]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">
        <aside className="lg:sticky lg:top-24 self-start rounded-3xl bg-card border border-ink/5 shadow-soft p-6">
          <AccountHeader />
          <nav className="mt-6 flex flex-col gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/account"
                  ? pathname === "/account"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-ink text-paper"
                      : "text-muted hover:bg-warm hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
            <button
              type="button"
              className="mt-4 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-error hover:bg-error/10 transition-colors"
            >
              <Power className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </aside>

        <main>{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `fe/src/app/(client)/account/layout.tsx`**

```tsx
import { AccountShell } from "@/components/account/account-shell";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AccountShell>{children}</AccountShell>;
}
```

- [ ] **Step 4: Verify build**

```bash
cd fe && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Smoke-check** `/account` and one sub-route (`/account/profile`). Active state should follow the URL.

- [ ] **Step 6: Commit**

```bash
git add fe/src/components/account/ fe/src/app/\(client\)/account/layout.tsx
git commit -m "feat(fe): phase D account shell — sidebar + content layout"
```

### Done criteria

- Sidebar renders with 8 nav items + avatar block + sign-out
- Active route highlights correctly on every sub-page
- Main content area receives the original `children` unchanged
- TypeScript clean, build passes

---

## Task 2: Restyle `/account` (Overview dashboard)

**Goal:** Welcome heading, three dashboard widgets (upcoming bookings, active membership, quick stats) laid out as cards in a grid. Reuse Phase C primitives.

**File:** Replace `fe/src/app/(client)/account/page.tsx`.

### Composition

1. `<SectionHeading eyebrow={\`Welcome back, \${mockUser.firstName}\`} title="Here's your practice" />`
2. Widget grid: `grid grid-cols-1 md:grid-cols-2 gap-6`.
   - **Upcoming bookings card:** `rounded-2xl bg-paper border border-ink/10 p-6`. Heading "Next up" (`text-sm font-semibold uppercase tracking-wider text-muted`). If the user has bookings: list up to 3 as rows (`flex items-center justify-between py-3 border-b border-ink/5 last:border-0`) — class name + instructor on the left, date + time on the right. Else: render `<EmptyState>` placeholder ("No upcoming bookings — browse classes"). Footer: "View all" link to `/account/history`.
   - **Active membership card:** same card style. Heading "Membership". Crown icon + tier name (`text-xl font-bold`). Renewal date (`text-sm text-muted`). Primary button "Manage membership" → `/account/membership`.
3. **Stats row:** three small cards `grid grid-cols-1 md:grid-cols-3 gap-4 mt-6`. Each: icon + big number (`text-3xl font-extrabold`) + label (`text-xs uppercase tracking-wider text-muted`). Stats: credits remaining (`/account/packages`), classes attended YTD, referrals sent.

### Steps

- [ ] **Step 1: Read current page** — preserve the data lookup (bookings + sessions + membership). Note any handlers for "sign out" or "manage" buttons.
- [ ] **Step 2: Replace** with composition above. Import `<EmptyState>` from `@/components/ui/empty-state` BUT note — that file is created in Task 17. For now, use an inline placeholder: `<p className="text-sm text-muted">No upcoming bookings.</p>`. After Task 17 completes, a follow-up commit will swap it in.
- [ ] **Step 3: Verify** build + smoke-check `/account`.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/page.tsx
  git commit -m "feat(fe): phase D account overview — dashboard widgets"
  ```

### Done criteria

- Two primary widgets + three stat cards render
- Links route to the correct sub-pages
- TypeScript clean, build passes

---

## Task 3: Restyle `/account/profile`

**Goal:** Form card with three grouped sections (personal info, contact, password). Preserve all existing form fields and submit handler.

**File:** Replace `fe/src/app/(client)/account/profile/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Profile" title="Account details" description="Keep your info current so we can reach you." />`
2. Three `rounded-2xl bg-paper border border-ink/10 p-8` cards stacked with `space-y-6`:
   - **Personal info:** first name, last name, DOB (three inputs in a `grid grid-cols-1 md:grid-cols-2 gap-4`). Each input uses Phase C's input pattern: `rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none`, label above with `text-xs uppercase tracking-wider text-muted mb-2 block`.
   - **Contact:** email (readonly), phone, address lines.
   - **Security:** current password + new password + confirm new password. "Change password" primary button at card bottom-right.
3. Footer action bar (`mt-8 flex justify-end gap-3`): "Cancel" (secondary) + "Save changes" (primary).

### Steps

- [ ] **Step 1: Read current page** — preserve every form field and its state.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/profile/page.tsx
  git commit -m "feat(fe): phase D account profile — grouped form cards"
  ```

### Done criteria

- All existing inputs still render and are editable
- Card grouping visually distinct
- TypeScript clean, build passes

---

## Task 4: Restyle `/account/history`

**Goal:** Filterable table of past bookings. Filter bar on top, table below, inside a card surface.

**File:** Replace `fe/src/app/(client)/account/history/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="History" title="Your bookings" />`
2. Card: `rounded-2xl bg-paper border border-ink/10 overflow-hidden`.
   - Filter bar: `flex items-center gap-3 p-6 border-b border-ink/10`. Contains: search input (`rounded-full border border-ink/10 bg-warm px-4 py-2 text-sm w-64`), status select (`All / Attended / Canceled`), date range select. Preserve existing filter state.
   - Table: semantic `<table>` with `w-full text-sm`. Header row `bg-warm text-xs uppercase tracking-wider text-muted`. Cells `px-6 py-4 border-b border-ink/5 last:border-0`. Columns: Date, Class, Instructor, Location, Status. Status renders as a pill — attended: `bg-sage/20 text-sage`, canceled: `bg-error/10 text-error`.
   - Empty fallback: inline placeholder (same Task 17 pattern as Task 2).

### Steps

- [ ] **Step 1: Read current page** — preserve the filter state + derived list.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/history/page.tsx
  git commit -m "feat(fe): phase D account history — filterable table"
  ```

### Done criteria

- Filter inputs still reduce the visible rows
- Status pills color-coded
- TypeScript clean, build passes

---

## Task 5: Restyle `/account/invoices`

**Goal:** Simple list of invoices with download buttons, inside a card.

**File:** Replace `fe/src/app/(client)/account/invoices/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Invoices" title="Payment records" description="Download receipts for your tax records." />`
2. `rounded-2xl bg-paper border border-ink/10 overflow-hidden` card. Inside: a list (`<ul className="divide-y divide-ink/5">`). Each `<li>` is `flex items-center justify-between px-6 py-4`. Left: invoice date (`text-sm font-medium`) + invoice number (`text-xs text-muted`). Right: amount (`text-sm font-semibold`) + "Download PDF" button (secondary, `rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent`).
3. Empty fallback: inline placeholder.

### Steps

- [ ] **Step 1: Read current page** — preserve `invoices.json` import.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/invoices/page.tsx
  git commit -m "feat(fe): phase D account invoices — divided list"
  ```

### Done criteria

- All invoices render
- Download button present per row
- TypeScript clean, build passes

---

## Task 6: Restyle `/account/membership`

**Goal:** Big hero card showing the current membership tier with renewal info and upgrade options.

**File:** Replace `fe/src/app/(client)/account/membership/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Membership" title="Your plan" />`
2. **Current plan card:** `rounded-3xl bg-ink text-paper p-10 shadow-soft`. Inside: crown icon + tier name (`text-3xl font-extrabold`), description (`text-base text-paper/70 mt-2`), renewal date (`text-sm text-paper/60 mt-6`), "Manage billing" button (secondary, inverted: `rounded-full bg-paper text-ink px-5 py-3 text-sm font-medium mt-6 hover:bg-paper/90`).
3. **Upgrade options section:** `mt-12`. `<SectionHeading eyebrow="Upgrade" title="Other plans" />` then `grid grid-cols-1 md:grid-cols-2 gap-6`. Each alternative plan: `rounded-2xl bg-paper border border-ink/10 p-8` with name, price (`text-2xl font-bold`), 3 benefits, "Switch to this plan" button (full-width secondary).

### Steps

- [ ] **Step 1: Read current page** — preserve the current-tier lookup from `memberships.json` + the upgrade list derived from `products.json`.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/membership/page.tsx
  git commit -m "feat(fe): phase D account membership — tier card + upgrades"
  ```

### Done criteria

- Current plan card visually distinct (dark background)
- Upgrade cards present where data exists
- TypeScript clean, build passes

---

## Task 7: Restyle `/account/packages`

**Goal:** Grid of owned package cards with balance, expiry, and use-history drawer. Keep the existing drawer open/close state.

**File:** Replace `fe/src/app/(client)/account/packages/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Packages" title="Your credits" description="Track balances and usage across all your packages." />`
2. `grid grid-cols-1 md:grid-cols-2 gap-6`. Each package card: `rounded-2xl bg-paper border border-ink/10 p-6 flex flex-col`.
   - Header: package name (`text-lg font-bold`) + expiry badge (`rounded-full bg-warm px-3 py-1 text-xs text-muted`).
   - Balance row: big number (`text-4xl font-extrabold text-ink`) + label ("credits remaining"). Progress bar below: `h-1.5 rounded-full bg-ink/10 overflow-hidden` with a filled span `bg-accent` sized by `used/total`.
   - Footer: "View history" button (secondary) toggles a drawer below the card listing past uses.
3. If a package is expired: card gets `opacity-60` + a small "Expired" pill top-right corner (`bg-error/10 text-error`).

### Steps

- [ ] **Step 1: Read current page** — preserve the packages data shape and the drawer state.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/packages/page.tsx
  git commit -m "feat(fe): phase D account packages — balance cards with drawers"
  ```

### Done criteria

- Progress bar reflects `used / total`
- Drawer toggle works on at least one card
- TypeScript clean, build passes

---

## Task 8: Restyle `/account/qr`

**Goal:** Large centered QR code inside a spotlight card, with download/share actions.

**File:** Replace `fe/src/app/(client)/account/qr/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Check-in" title="Your studio QR" description="Show this at the front desk to check into your class." align="center" />`
2. Spotlight card: `max-w-md mx-auto rounded-3xl bg-card border border-ink/5 shadow-soft p-10 text-center`.
   - QR block: `h-64 w-64 mx-auto rounded-2xl bg-paper border border-ink/10 p-4 flex items-center justify-center`. Inside: existing `<QRCode value={...}>` component.
   - Below QR: user name (`text-lg font-semibold mt-6`), member since date (`text-sm text-muted`).
   - Action row: `mt-8 flex gap-3 justify-center`. "Download PNG" (secondary) + "Add to Wallet" (primary).

### Steps

- [ ] **Step 1: Read current page** — preserve the QR value source.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check (QR must render against a known value).
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/qr/page.tsx
  git commit -m "feat(fe): phase D account QR — spotlight card"
  ```

### Done criteria

- QR renders at 256×256
- Action buttons present (no-op handlers are fine — prototype)
- TypeScript clean, build passes

---

## Task 9: Restyle `/account/referral`

**Goal:** Highlight card with the user's referral link + earnings tracker + "How it works" strip.

**File:** Replace `fe/src/app/(client)/account/referral/page.tsx`.

### Composition

1. `<SectionHeading eyebrow="Referral" title="Invite friends, earn credits" />`
2. **Link card:** `rounded-3xl bg-accent/10 border border-accent/30 p-8`. Inside: big copy-link field `flex items-center gap-3` — input `flex-1 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm font-mono text-ink/80` readonly with the referral URL; "Copy link" primary button right of it (`rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium`). Below: "Shared via WhatsApp / Email" secondary actions row (`flex gap-2 mt-4`).
3. **Earnings tracker:** `grid grid-cols-3 gap-4 mt-6`. Three stat cards (same pattern as Task 2 stats): friends invited, friends joined, credits earned.
4. **How it works strip:** `mt-12 grid grid-cols-1 md:grid-cols-3 gap-6`. Three numbered steps each in a `rounded-2xl bg-paper border border-ink/10 p-6`: 1 Share your link, 2 Friend books their first class, 3 Both of you get credits.

### Steps

- [ ] **Step 1: Read current page** — preserve the referral code/URL source.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/account/referral/page.tsx
  git commit -m "feat(fe): phase D account referral — link card + tracker + how-it-works"
  ```

### Done criteria

- Referral URL visible in the input
- Copy button present (no-op is fine)
- Three-step strip present
- TypeScript clean, build passes

---

## Task 10: `AuthSplitShell` — split-screen auth layout

**Goal:** Build the shared split-screen shell used by all six auth routes. Left panel: full-height photo + brand wordmark + soft quote overlay. Right panel: form card vertically centered.

**Files:**
- Create: `fe/src/components/auth/auth-split-shell.tsx`

- [ ] **Step 1: Create `fe/src/components/auth/auth-split-shell.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";
import { img } from "@/data/images";

type AuthSplitShellProps = {
  imageKey: string;
  quote?: string;
  children: React.ReactNode;
};

export function AuthSplitShell({
  imageKey,
  quote,
  children,
}: AuthSplitShellProps) {
  const image = img(imageKey);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-72px)]">
      <div className="relative hidden lg:block">
        <Image
          src={image.unsplash}
          alt={image.alt}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 0vw"
          className="object-cover photo-warm"
        />
        <div className="absolute inset-0 bg-ink/30" />
        <div className="absolute inset-0 flex flex-col justify-between p-12 text-paper">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Yoga Sadhana
          </Link>
          {quote ? (
            <blockquote className="max-w-md text-2xl font-serif leading-snug">
              &ldquo;{quote}&rdquo;
            </blockquote>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-center bg-paper px-6 py-12 md:px-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `cd fe && npx tsc --noEmit`. Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add fe/src/components/auth/auth-split-shell.tsx
git commit -m "feat(fe): phase D auth split shell — photo panel + form panel"
```

### Done criteria

- Shell renders photo panel on desktop (≥lg), hides it on mobile
- Form panel vertically centers its children
- TypeScript clean

---

## Task 11: Restyle `/login`

**File:** Replace `fe/src/app/(client)/login/page.tsx`.

### Composition

- Wrap entire page in `<AuthSplitShell imageKey="hero-yoga-01" quote="The pose you avoid is the one you need most.">`.
- Inside form panel:
  - `text-3xl font-extrabold tracking-tight text-ink` heading "Welcome back".
  - `text-sm text-muted mt-2` subheading "Sign in to continue your practice."
  - Form stack `mt-10 space-y-4`. Email + password inputs (Phase C input pattern). Remember-me checkbox + "Forgot password?" link on same row (`flex items-center justify-between text-xs mt-2`).
  - Primary submit button: full-width `rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6`.
  - Divider `my-8 flex items-center gap-3 text-xs text-muted` with lines + "or continue with" label.
  - Social button row (Google + Apple) — two secondary buttons side by side. These may be no-op; preserve current behavior.
  - Footer: `text-sm text-muted text-center mt-8` with "Don't have an account? <Link href='/register' className='text-accent-deep font-medium'>Sign up</Link>".

### Steps

- [ ] **Step 1: Read current page** — preserve email/password state + submit handler.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/login/page.tsx
  git commit -m "feat(fe): phase D login — split-screen auth"
  ```

### Done criteria

- Split shell renders correctly on desktop + mobile (photo hidden on mobile)
- Form submits (even if no-op)
- TypeScript clean, build passes

---

## Task 12: Restyle `/register`

**File:** Replace `fe/src/app/(client)/register/page.tsx`.

### Composition

- `<AuthSplitShell imageKey="hero-pilates-01" quote="Every student begins with a single breath.">`
- Heading "Create your account". Subheading "Two locations. One practice."
- Fields (same input pattern): first name + last name (two columns at `md:grid-cols-2 gap-4`), email, phone, DOB, password, confirm password.
- Terms checkbox: `flex items-start gap-3 mt-4` + inline text "I agree to the <Link>Terms</Link> and <Link>Privacy Policy</Link>."
- Primary submit "Create account" (full-width).
- Footer: "Already have an account? Sign in".

### Steps

- [ ] **Step 1: Read current page** — preserve every field + handler.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/register/page.tsx
  git commit -m "feat(fe): phase D register — split-screen auth"
  ```

### Done criteria

- All existing fields render
- Terms checkbox present
- TypeScript clean, build passes

---

## Task 13: Restyle `/forgot-password`

**File:** Replace `fe/src/app/(client)/forgot-password/page.tsx`.

### Composition

- `<AuthSplitShell imageKey="hero-meditation-01" quote="Stillness is the teacher.">`
- Heading "Forgot your password?". Subheading "Enter your email and we'll send you a reset link."
- Single email input + full-width primary "Send reset link" button.
- After submit, swap the form for a success panel: centered check-circle icon (green `h-12 w-12 text-sage`) + `text-xl font-bold` "Check your email" + `text-sm text-muted` with the email echoed back.
- Footer: "Back to sign in" link.

### Steps

- [ ] **Step 1: Read current page** — preserve submitted-state flag + email state.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check (submit once, confirm success panel).
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/forgot-password/page.tsx
  git commit -m "feat(fe): phase D forgot-password — split-screen auth"
  ```

### Done criteria

- Submit reveals success panel
- Email is echoed on success
- TypeScript clean, build passes

---

## Task 14: Restyle `/reset-password`

**File:** Replace `fe/src/app/(client)/reset-password/page.tsx`.

### Composition

- `<AuthSplitShell imageKey="hero-yoga-01" quote="Reset. Breathe. Begin again.">`
- Heading "Set a new password". Subheading "Choose something you'll remember (or store in a password manager)."
- Two password inputs: new password + confirm. Inline validation message (`text-xs text-error mt-2`) when mismatch.
- Primary submit "Update password" (full-width).
- After success: swap for success panel (check-circle + "Password updated" + "Sign in" link).

### Steps

- [ ] **Step 1: Read current page** — preserve token param + submit handler.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/reset-password/page.tsx
  git commit -m "feat(fe): phase D reset-password — split-screen auth"
  ```

### Done criteria

- Mismatch warning appears when confirm ≠ new
- Success panel shows after submit
- TypeScript clean, build passes

---

## Task 15: Restyle `/verify-email`

**File:** Replace `fe/src/app/(client)/verify-email/page.tsx`.

### Composition

- `<AuthSplitShell imageKey="hero-meditation-01" quote="One step closer to your first class.">`
- Heading "Verify your email". Subheading "We sent a 6-digit code to <email>. Enter it below."
- 6-digit OTP input: six separate `<input maxLength={1} className="h-14 w-12 rounded-xl border border-ink/10 bg-paper text-center text-2xl font-bold text-ink focus:border-accent focus:outline-none">` in a flex row with gap. Focus jumps forward on input (preserve existing focus logic if present).
- "Resend code" link (`text-sm text-accent-deep mt-4`) with cooldown counter if current page has one.
- Primary submit "Verify" (full-width).

### Steps

- [ ] **Step 1: Read current page** — preserve OTP state + focus management.
- [ ] **Step 2: Replace** with composition. Do not change focus-jump logic.
- [ ] **Step 3: Verify** build + smoke-check (typing digits advances focus).
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/verify-email/page.tsx
  git commit -m "feat(fe): phase D verify-email — split-screen auth with OTP"
  ```

### Done criteria

- OTP boxes render in a row
- Focus advances as digits are entered
- TypeScript clean, build passes

---

## Task 16: Restyle `/waiver`

**File:** Replace `fe/src/app/(client)/waiver/page.tsx`.

### Composition

- `<AuthSplitShell imageKey="hero-pilates-01" quote="Practice safely. Practice well.">`
- Heading "Studio waiver". Subheading "Please read and acknowledge before your first class."
- Scrollable waiver body: `max-h-80 overflow-y-auto rounded-xl border border-ink/10 bg-warm p-6 text-sm text-ink/80 leading-relaxed space-y-3 mt-6`. Preserve the existing waiver text.
- Acknowledgment: checkbox + inline text "I have read and agree to the terms above." (`flex items-start gap-3 mt-6`).
- Signature row: `flex gap-3 mt-4`. "Type your full name" input (`rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm font-mono` — mono for signature feel).
- Primary submit "I agree and sign" (full-width, disabled until checkbox + name both present — preserve existing disabled logic).

### Steps

- [ ] **Step 1: Read current page** — preserve the acknowledgment state + signature state + disabled logic.
- [ ] **Step 2: Replace** with composition.
- [ ] **Step 3: Verify** build + smoke-check (disabled state toggles correctly).
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/waiver/page.tsx
  git commit -m "feat(fe): phase D waiver — split-screen auth with signature"
  ```

### Done criteria

- Waiver body scrolls inside its container
- Submit disabled until checkbox + signature present
- TypeScript clean, build passes

---

## Task 17: `EmptyState` + `Skeleton` primitives

**Goal:** Add the two small UI primitives referenced by earlier tasks (Tasks 2, 4, 5) so list pages have a consistent empty/loading look.

**Files:**
- Create: `fe/src/components/ui/empty-state.tsx`
- Create: `fe/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Create `fe/src/components/ui/empty-state.tsx`**

```tsx
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  cta?: { href: string; label: string };
};

export function EmptyState({ icon: Icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      {Icon ? (
        <div className="mx-auto h-12 w-12 rounded-full bg-warm flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-muted" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{description}</p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="inline-flex items-center mt-6 rounded-full bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:bg-ink/90"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `fe/src/components/ui/skeleton.tsx`**

```tsx
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-ink/5",
        className,
      )}
    />
  );
}
```

- [ ] **Step 3: Wire `<EmptyState>` into the three pages** that used inline placeholders (Task 2 overview widget, Task 4 history table, Task 5 invoices list). Replace each inline placeholder with an `<EmptyState>` invocation using an appropriate lucide icon (`CalendarX`, `ClipboardX`, `FileX`).

- [ ] **Step 4: Verify** — `cd fe && npx tsc --noEmit && npm run build`. Both exit 0.

- [ ] **Step 5: Commit**

```bash
git add fe/src/components/ui/ fe/src/app/\(client\)/account/page.tsx fe/src/app/\(client\)/account/history/page.tsx fe/src/app/\(client\)/account/invoices/page.tsx
git commit -m "feat(fe): phase D empty-state + skeleton primitives; wire empty states into account pages"
```

### Done criteria

- Both primitives exported and type-clean
- Account overview, history, invoices show `<EmptyState>` when their lists are empty
- TypeScript clean, build passes

---

## Task 18: Mobile responsive pass

**Goal:** Walk every redesigned route on mobile (375×812) via Playwright and fix any overflow, stacking, or tap-target issues. This is an audit + surgical fixes task, not a rewrite.

**Files:**
- Modify: any `.tsx` file needing a responsive fix
- Create (if issues found): `docs/superpowers/specs/phase-d-mobile-issues.md`

### Routes to audit (375×812)

Phase B: `/`, `/pricing`
Phase C: `/classes`, `/packages`, `/workshops`, `/workshops/<id>`, `/private-sessions`, `/private-sessions/<id>`, `/checkout`, `/booking/confirmation`
Phase D: `/account`, `/account/profile`, `/account/history`, `/account/invoices`, `/account/membership`, `/account/packages`, `/account/qr`, `/account/referral`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/waiver`

### Audit checks per route

1. **No horizontal overflow** — `document.documentElement.scrollWidth === window.innerWidth`.
2. **Sidebar collapses** on account pages (AccountShell stacks vertically at `lg:` breakpoint — the current CSS does this, verify).
3. **Sticky elements** (workshop detail, checkout summary) stack below content on mobile.
4. **Tap targets ≥ 44×44px** for primary buttons.
5. **Hero compact doesn't clip** headline text on any page.

### Steps

- [ ] **Step 1:** `cd fe && npm run dev` in background.
- [ ] **Step 2:** For each route, use Playwright MCP to set viewport 375×812 and evaluate `document.documentElement.scrollWidth - window.innerWidth`. Any value > 0 = overflow bug. Log to a findings list.
- [ ] **Step 3:** For each overflow bug, locate the offending element via visual inspection and apply the narrowest fix (usually: add `min-w-0` to a flex child, or change `grid-cols-2` to `grid-cols-1` at mobile, or `overflow-x-auto` on a table wrapper). Commit one fix per bug.
- [ ] **Step 4:** If no bugs found, create an empty `phase-d-mobile-issues.md` noting the audit date and that no issues were found.
- [ ] **Step 5: Commit** (even if no fixes, commit the issues file):

```bash
git add .
git commit -m "fix(fe): phase D mobile responsive pass" --allow-empty
```

### Done criteria

- No route reports horizontal overflow at 375px
- Fix commits are small and focused (one bug per commit)
- Issues file exists (empty is OK)

---

## Task 19: Visual smoke verification

**Goal:** Capture snapshots across every Phase D route + regression checks on Phase B/C routes.

**Files to create:**
- `docs/superpowers/specs/phase-d-snapshots/` (directory)

### Routes to capture (desktop 1440×900 + mobile 375×812)

Desktop (Phase D):
- `/account` → `account-overview-desktop.png`
- `/account/profile` → `account-profile-desktop.png`
- `/account/history` → `account-history-desktop.png`
- `/account/invoices` → `account-invoices-desktop.png`
- `/account/membership` → `account-membership-desktop.png`
- `/account/packages` → `account-packages-desktop.png`
- `/account/qr` → `account-qr-desktop.png`
- `/account/referral` → `account-referral-desktop.png`
- `/login` → `login-desktop.png`
- `/register` → `register-desktop.png`
- `/forgot-password` → `forgot-password-desktop.png`
- `/reset-password` → `reset-password-desktop.png`
- `/verify-email` → `verify-email-desktop.png`
- `/waiver` → `waiver-desktop.png`

Mobile:
- `/account` → `account-overview-mobile.png`
- `/account/packages` → `account-packages-mobile.png`
- `/login` → `login-mobile.png`

Regression (Phase B + C):
- `/` → `home-desktop.png`
- `/pricing` → `pricing-desktop.png`
- `/classes` → `classes-desktop.png`
- `/checkout` → `checkout-desktop.png`

### Acceptance criteria

1. ✅/❌ **AccountShell sidebar renders** on all 8 account routes, active state tracks URL.
2. ✅/❌ **AuthSplitShell photo panel visible** at desktop on all 6 auth routes, hidden on mobile.
3. ✅/❌ **Sign-out button** styled in error color in sidebar.
4. ✅/❌ **OTP inputs** render as 6 separate boxes on verify-email.
5. ✅/❌ **Waiver body scrolls** inside its container on desktop and mobile.
6. ✅/❌ **EmptyState renders** with icon + title + CTA when lists are empty.
7. ✅/❌ **No horizontal overflow** on any mobile route.
8. ✅/❌ **Phase B + C pages unchanged** — no regression.
9. ✅/❌ **No console errors** on any route.

### Steps

- [ ] **Step 1:** `cd fe && npm run dev` in background.
- [ ] **Step 2:** Capture all listed screenshots via Playwright MCP. Save to `docs/superpowers/specs/phase-d-snapshots/`.
- [ ] **Step 3:** Spot-check console on each desktop route.
- [ ] **Step 4:** Evaluate criteria 1–9 against screenshots.
- [ ] **Step 5:** If any criterion fails, file to `docs/superpowers/specs/phase-d-issues.md`. If all pass, skip.
- [ ] **Step 6: Commit + tag.**

```bash
git add docs/superpowers/specs/phase-d-snapshots/
[ -f docs/superpowers/specs/phase-d-issues.md ] && git add docs/superpowers/specs/phase-d-issues.md
git commit -m "chore(fe): phase D visual verification snapshots" --allow-empty
git tag phase-d-polish
```

- [ ] **Step 7:** Stop the dev server. If the harness blocks process kill, leave it and report.

### Done criteria

- All 9 acceptance criteria evaluated (each ✅ or ❌)
- Snapshots committed
- Tag `phase-d-polish` created

---

## Phase D Done Criteria

All nineteen tasks complete AND:
- `AccountShell` + `AccountHeader` live in `fe/src/components/account/`
- `AuthSplitShell` lives in `fe/src/components/auth/`
- `EmptyState` + `Skeleton` live in `fe/src/components/ui/`
- 9 account routes rebuilt on top of `AccountShell`
- 6 auth routes rebuilt on top of `AuthSplitShell`
- Mobile responsive pass complete with no overflow at 375px
- `npm run build` exits 0 from `fe/`
- `phase-d-polish` tag exists
- Visual snapshots committed
- Data shapes and handlers untouched (grep check: no changes to `fe/src/data/`)
- All review issues either resolved or escalated

When all are green, the redesign is complete end-to-end: every PRD-scoped route reskinned in the rezerv-inspired visual system. Hand off to release prep (merge `redesign/phase-d-polish` → main via PR).

---

## Notes for the Controller

- **Stitch MCP is available** — most useful for Task 1 (AccountShell sidebar) and Task 10 (AuthSplitShell split-screen) where the visual composition is new and high-stakes. Prompt with rezerv.co reference + design tokens.
- **Frontend-design skill is also available** — alternative to Stitch.
- **Worktree:** branch `redesign/phase-d-polish` is the workspace; do not switch branches.
- **Rollback:** each task is one commit. `git revert <sha>` is safer than in-place fixes.
- **Data integrity check before each commit:** `git diff HEAD -- fe/src/data/` must be empty. Phase D does not touch data.
- **Order matters:** Task 1 must complete before any account page restyle (Tasks 2–9 depend on `AccountShell`). Task 10 must complete before any auth page restyle (Tasks 11–16 depend on `AuthSplitShell`). Task 17 (EmptyState) can ship before Tasks 2/4/5 and backfill them, OR ship after with the wiring commit — the plan takes the latter path for linear readability.
