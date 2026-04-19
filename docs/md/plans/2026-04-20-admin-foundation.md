# Admin Portal — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a standalone Next.js admin app at `fe-admin/` that boots, signs in a seeded admin user, renders a navigable shell with sidebar + topbar, shows a working Dashboard backed by in-memory mock data, and leaves every other admin route as a reachable placeholder ready for Phase 2+.

**Architecture:** Sibling app to `fe/`. Own `package.json`, own Vercel deploy. Tailwind v4 tokens and Manrope typography are copied verbatim from `fe/src/app/globals.css` and `fe/src/app/layout.tsx` so the visual language is identical to the client portal. State and auth use the same `useSyncExternalStore` + `localStorage` pattern as `fe/src/lib/mock-state.ts`, keyed to `admin-mock-state:v1` so admin and client sessions are isolated per browser. Mock data is self-contained in `fe-admin/src/data/`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6, Tailwind CSS 4 (`@theme` tokens, `@tailwindcss/postcss`), lucide-react, clsx, tailwind-merge, date-fns, framer-motion, recharts (deferred to Phase 4).

**Spec reference:** `docs/md/prd-admin.md`.

**Out of scope for Phase 1:** Every module page beyond Dashboard (Schedule, Bookings, Check-in, Requests, Clients, Catalog, Instructors, Locations, Invoices, Reports, Notifications, Waivers, Referrals, Settings). Those pages exist as placeholders in Phase 1 and are filled in by Phases 2–4.

---

## File Structure

```
fe-admin/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── next-env.d.ts
├── eslint.config.mjs
├── .gitignore
├── public/
│   └── brand/                         # copied from fe/public/brand/
└── src/
    ├── app/
    │   ├── layout.tsx                 # Root layout — fonts + metadata
    │   ├── globals.css                # Design tokens (copy of fe/globals.css)
    │   ├── page.tsx                   # Root redirect: "/" → "/login" or "/dashboard"
    │   ├── login/
    │   │   └── page.tsx               # Admin sign-in
    │   └── (admin)/
    │       ├── layout.tsx             # AdminShell (sidebar + topbar + auth guard)
    │       ├── page.tsx               # Dashboard (/)
    │       ├── schedule/page.tsx      # Placeholder
    │       ├── bookings/page.tsx      # Placeholder
    │       ├── check-in/page.tsx      # Placeholder
    │       ├── requests/page.tsx      # Placeholder
    │       ├── clients/page.tsx       # Placeholder
    │       ├── catalog/
    │       │   ├── packages/page.tsx  # Placeholder
    │       │   ├── workshops/page.tsx # Placeholder
    │       │   └── classes/page.tsx   # Placeholder
    │       ├── instructors/page.tsx   # Placeholder
    │       ├── locations/page.tsx     # Placeholder
    │       ├── invoices/page.tsx      # Placeholder
    │       ├── reports/page.tsx       # Placeholder
    │       ├── notifications/page.tsx # Placeholder
    │       ├── waivers/page.tsx       # Placeholder
    │       ├── referrals/page.tsx     # Placeholder
    │       └── settings/page.tsx      # Placeholder
    ├── components/
    │   ├── layout/
    │   │   ├── admin-shell.tsx
    │   │   ├── admin-sidebar.tsx
    │   │   ├── admin-topbar.tsx
    │   │   └── auth-guard.tsx
    │   └── ui/
    │       ├── button.tsx
    │       ├── badge.tsx
    │       ├── card.tsx
    │       ├── input.tsx
    │       ├── label.tsx
    │       ├── select.tsx
    │       ├── textarea.tsx
    │       ├── table.tsx
    │       ├── tabs.tsx
    │       ├── modal.tsx
    │       ├── empty-state.tsx
    │       ├── stat-card.tsx
    │       ├── page-header.tsx
    │       ├── sla-chip.tsx
    │       └── audit-timeline.tsx
    ├── lib/
    │   ├── utils.ts                   # cn, formatCurrency, formatDate, formatTime, getLocation*
    │   ├── date.ts                    # week math, SLA helpers
    │   ├── sla.ts                     # private-session SLA computation
    │   ├── mock-auth.ts               # signIn/signOut/isLoggedIn wrappers
    │   └── mock-state.ts              # useSyncExternalStore + localStorage
    ├── data/
    │   ├── admin-users.json
    │   ├── clients.json
    │   ├── instructors.json
    │   ├── locations.json
    │   ├── tenants.json
    │   ├── products.json
    │   ├── memberships.json
    │   ├── client-packages.json
    │   ├── invoices.json
    │   ├── session-templates.json
    │   ├── sessions.json
    │   ├── bookings.json
    │   ├── private-requests.json
    │   ├── credit-adjustments.json
    │   ├── refunds.json
    │   ├── waiver-signatures.json
    │   ├── email-templates.json
    │   └── session-cancellations.json
    └── types/
        └── index.ts
```

---

## Verification Strategy

This is a frontend mockup. There is no test runner in the repo. Verification per task uses the following tools:

- **Type check:** `cd fe-admin && npx tsc --noEmit`
- **Build check:** `cd fe-admin && npm run build`
- **Dev server smoke:** `cd fe-admin && npm run dev -- --port 3100`, then hit `http://localhost:3100/<route>` with Playwright (`browser_navigate`, `browser_snapshot`) to confirm the page renders without runtime errors.
- **Commit:** after each task passes its verification.

No unit tests are introduced in Phase 1. A Playwright MCP smoke run at the end of Phase 1 is the acceptance gate.

---

## Task 0 — Preconditions

**Files:** none. This is a branch/working-tree check.

- [ ] **Step 1:** Confirm working tree is clean enough to scaffold a new app. Uncommitted changes in `fe/` are OK (we are not touching `fe/`). From the repo root:

```bash
git status --short | grep -v "^.M fe/\|^?? fe/\|^.M docs/md/prd-admin.md\|^?? docs/md/plans/" && echo "UNEXPECTED DIRT" || echo "OK"
```

Expected: `OK`

- [ ] **Step 2:** Confirm Node 20+ and npm are available.

```bash
node --version && npm --version
```

Expected: Node `v20.x` or higher.

---

## Task 1 — Scaffold `fe-admin/` directory + `package.json`

**Files:**
- Create: `fe-admin/package.json`

- [ ] **Step 1:** Create the directory.

```bash
mkdir -p fe-admin/src/app fe-admin/src/components/layout fe-admin/src/components/ui fe-admin/src/lib fe-admin/src/data fe-admin/src/types fe-admin/public/brand
```

- [ ] **Step 2:** Create `fe-admin/package.json`. Dependency versions match `fe/package.json` exactly so the two apps stay in lockstep.

```json
{
  "name": "fe-admin",
  "version": "1.0.0",
  "description": "Yoga Sadhana admin portal (mockup)",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3100",
    "build": "next build",
    "start": "next start --port 3100",
    "lint": "next lint"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "framer-motion": "^12.38.0",
    "lucide-react": "^1.8.0",
    "next": "^16.2.1",
    "qrcode.react": "^4.2.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "recharts": "^3.8.1",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.2.2",
    "@types/node": "^25.5.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "eslint": "^9.39.4",
    "postcss": "^8.5.8",
    "tailwindcss": "^4.2.2",
    "typescript": "^6.0.2"
  }
}
```

- [ ] **Step 3:** Install.

```bash
cd fe-admin && npm install
```

Expected: exits 0, creates `fe-admin/node_modules/` and `fe-admin/package-lock.json`.

- [ ] **Step 4:** Commit.

```bash
git add fe-admin/package.json fe-admin/package-lock.json
git commit -m "chore(fe-admin): scaffold package and install deps"
```

---

## Task 2 — Config files

**Files:**
- Create: `fe-admin/tsconfig.json`, `fe-admin/next.config.ts`, `fe-admin/postcss.config.mjs`, `fe-admin/next-env.d.ts`, `fe-admin/eslint.config.mjs`, `fe-admin/.gitignore`

- [ ] **Step 1:** Create `fe-admin/tsconfig.json` (identical to `fe/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2:** Create `fe-admin/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 3:** Create `fe-admin/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 4:** Create `fe-admin/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 5:** Create `fe-admin/eslint.config.mjs`:

```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
```

- [ ] **Step 6:** Create `fe-admin/.gitignore`:

```
node_modules
.next
out
.env*.local
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 7:** Type-check the empty project.

```bash
cd fe-admin && npx tsc --noEmit
```

Expected: exits 0 (no files to check yet, but config is valid).

- [ ] **Step 8:** Commit.

```bash
git add fe-admin/tsconfig.json fe-admin/next.config.ts fe-admin/postcss.config.mjs fe-admin/next-env.d.ts fe-admin/eslint.config.mjs fe-admin/.gitignore
git commit -m "chore(fe-admin): add next/typescript/tailwind/eslint configs"
```

---

## Task 3 — Copy design tokens + root layout

**Files:**
- Create: `fe-admin/src/app/globals.css` (copy of `fe/src/app/globals.css`)
- Create: `fe-admin/src/app/layout.tsx`
- Copy: `fe/public/brand/*` → `fe-admin/public/brand/*`

- [ ] **Step 1:** Copy globals.css verbatim.

```bash
cp fe/src/app/globals.css fe-admin/src/app/globals.css
```

- [ ] **Step 2:** Copy brand assets.

```bash
cp -r fe/public/brand/. fe-admin/public/brand/
```

- [ ] **Step 3:** Create `fe-admin/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yoga Sadhana — Admin",
  description: "Admin portal for Yoga Sadhana studio operations.",
  icons: {
    icon: "/brand/favicon.jpg",
    apple: "/brand/apple-icon.jpg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4:** Add a temporary `fe-admin/src/app/page.tsx` so Next has a route to build:

```tsx
export default function TempRoot() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper text-ink">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold">Yoga Sadhana Admin</h1>
        <p className="text-muted mt-2 font-mono text-sm">Scaffold ready.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 5:** Build the app.

```bash
cd fe-admin && npm run build
```

Expected: build succeeds; `.next/` directory created; no type errors.

- [ ] **Step 6:** Dev-server smoke.

```bash
cd fe-admin && npm run dev
```

In another shell / Playwright: navigate to `http://localhost:3100/`. Expected: page renders "Yoga Sadhana Admin" with Manrope font on paper background. Stop the server with Ctrl-C after confirming.

- [ ] **Step 7:** Commit.

```bash
git add fe-admin/src/app/globals.css fe-admin/src/app/layout.tsx fe-admin/src/app/page.tsx fe-admin/public/brand/
git commit -m "feat(fe-admin): add root layout, design tokens, brand assets"
```

---

## Task 4 — Types

**Files:**
- Create: `fe-admin/src/types/index.ts`

- [ ] **Step 1:** Create `fe-admin/src/types/index.ts`. This is the full type surface needed by Phase 1 through Phase 4; later phases don't need to extend it. Shapes mirror `fe/src/types/index.ts` where entities overlap; admin-only entities are added at the bottom.

```ts
// --- Tenant ---
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: "starter" | "growth" | "professional";
  status: "active" | "incomplete" | "suspended";
  createdAt: string;
}

// --- Location ---
export interface Location {
  id: string;
  tenantId: string;
  name: string;
  shortName: string;
  address: string;
  area: string;
  mapUrl?: string;
  rooms?: number;
  amenities?: string[];
}

// --- Instructor ---
export interface Instructor {
  id: string;
  tenantId: string;
  name: string;
  bio: string;
  photo: string;
  specialties: string[];
  availability?: InstructorAvailability[];
}

export interface InstructorAvailability {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sun
  startTime: string; // "HH:mm"
  endTime: string;
}

// --- Client ---
export interface Client {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  registeredAt: string;
  activityStatus: "active" | "inactive";
  noShowCount: number;
  totalSessions: number;
  tags: string[];
  waiverSigned: boolean;
  waiverSignedAt: string | null;
  waiverVersion: string | null;
  referralCode: string;
  referredBy: string | null;
  notes?: string;
}

// --- Session ---
export interface Session {
  id: string;
  tenantId: string;
  locationId: string | null;
  templateId: string | null;
  name: string;
  category: string;
  level: "beginner" | "intermediate" | "advanced" | "all";
  type: "regular" | "workshop" | "private";
  instructorId: string;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:mm
  duration: number;  // minutes
  price: number;     // SGD; 0 for credit-based
  status: "scheduled" | "cancelled" | "completed";
  recurrence: string | null;
}

// --- Session Template (admin-only) ---
export interface SessionTemplate {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  category: string;
  level: Session["level"];
  instructorId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
  duration: number;
  capacity: number;
  creditCost: number;
  active: boolean;
}

// --- Booking ---
export interface Booking {
  id: string;
  clientId: string;
  sessionId: string;
  status: "confirmed" | "cancelled" | "waitlisted";
  checkInStatus: "pending" | "attended" | "late" | "no-show";
  packageId: string | null;
  rating: number | null;
  createdAt: string;
  promotedFromWaitlist?: boolean;
}

// --- Product / Package catalogue ---
export interface Product {
  id: string;
  tenantId: string;
  name: string;
  type: "package" | "membership" | "workshop" | "private-pack";
  creditType: "class" | "pt" | "none";
  price: number;
  sessionCount: number | null;
  expiryDays: number | null;
  sessionsPerMonth: number | null;
  description: string;
  active: boolean;
}

// --- Client Package (instance of a purchased product) ---
export interface ClientPackage {
  id: string;
  clientId: string;
  productId: string;
  purchasedAt: string;
  expiresAt: string;
  creditsTotal: number;
  creditsRemaining: number;
  status: "active" | "expired" | "depleted";
}

// --- Membership ---
export interface Membership {
  id: string;
  clientId: string;
  productId: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "paused" | "cancelled" | "expired";
}

// --- Invoice ---
export interface Invoice {
  id: string;
  clientId: string;
  issuedAt: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "paid" | "refunded" | "partially-refunded" | "void";
  paymentMethod: "stripe" | "manual";
  referenceId?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  amount: number;
}

// --- Private Session Request (admin-only) ---
export interface PrivateRequest {
  id: string;
  clientId: string;
  preferredInstructorId: string | null;
  proposedSlots: { date: string; time: string }[];
  notes: string;
  submittedAt: string;
  deadlineAt: string;                       // 12h from submittedAt
  status: "pending" | "approved" | "declined";
  resolution?: {
    resolvedAt: string;
    resolvedBy: string;                      // admin user id
    scheduledDate?: string;
    scheduledTime?: string;
    declineReason?: string;
  };
}

// --- Admin User ---
export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

// --- Audit rows ---
export interface CreditAdjustment {
  id: string;
  clientId: string;
  packageId: string | null;
  delta: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  invoiceId: string;
  amount: number;
  reason: string;
  adminId: string;
  createdAt: string;
}

export interface SessionCancellation {
  id: string;
  sessionId: string;
  reason: string;
  adminId: string;
  creditsRefunded: number;
  clientsAffected: string[];
  createdAt: string;
}

// --- Waiver ---
export interface WaiverSignature {
  clientId: string;
  version: string;
  signedAt: string;
  status: "current" | "outdated";
}

// --- Email template ---
export interface EmailTemplate {
  event: string;           // e.g. "booking-confirmed"
  subject: string;
  body: string;            // mustache-like placeholders, e.g. {{client.firstName}}
  updatedAt: string;
}
```

- [ ] **Step 2:** Type-check.

```bash
cd fe-admin && npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3:** Commit.

```bash
git add fe-admin/src/types/index.ts
git commit -m "feat(fe-admin): add type definitions"
```

---

## Task 5 — Utility libs

**Files:**
- Create: `fe-admin/src/lib/utils.ts`
- Create: `fe-admin/src/lib/date.ts`
- Create: `fe-admin/src/lib/sla.ts`

- [ ] **Step 1:** Create `fe-admin/src/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Location } from "@/types";
import locationsData from "@/data/locations.json";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

const typedLocations = locationsData as Location[];

export function getLocation(locationId: string | null): Location | undefined {
  if (!locationId) return undefined;
  return typedLocations.find((l) => l.id === locationId);
}

export function getLocationName(locationId: string | null): string {
  return getLocation(locationId)?.shortName ?? "—";
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}
```

- [ ] **Step 2:** Create `fe-admin/src/lib/date.ts`:

```ts
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // week starts Monday
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekdayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function monthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

- [ ] **Step 3:** Create `fe-admin/src/lib/sla.ts`:

```ts
export type SlaTier = "green" | "amber" | "red" | "overdue";

export function slaTier(deadlineIso: string, nowMs = Date.now()): SlaTier {
  const hoursLeft = (new Date(deadlineIso).getTime() - nowMs) / (1000 * 60 * 60);
  if (hoursLeft <= 0) return "overdue";
  if (hoursLeft < 2) return "red";
  if (hoursLeft <= 6) return "amber";
  return "green";
}

export function slaLabel(deadlineIso: string, nowMs = Date.now()): string {
  const ms = new Date(deadlineIso).getTime() - nowMs;
  if (ms <= 0) {
    const overdueH = Math.floor(-ms / (1000 * 60 * 60));
    return overdueH > 0 ? `Overdue ${overdueH}h` : "Overdue";
  }
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (h >= 1) return `${h}h ${m}m left`;
  return `${m}m left`;
}
```

- [ ] **Step 4:** Type-check (will currently fail because `locations.json` does not exist yet — that is expected; Task 6 fixes it).

- [ ] **Step 5:** Commit.

```bash
git add fe-admin/src/lib/utils.ts fe-admin/src/lib/date.ts fe-admin/src/lib/sla.ts
git commit -m "feat(fe-admin): add utility libs (cn, dates, sla)"
```

---

## Task 6 — Seed data: reference entities

**Files:**
- Create: `fe-admin/src/data/tenants.json`
- Create: `fe-admin/src/data/locations.json`
- Create: `fe-admin/src/data/admin-users.json`
- Create: `fe-admin/src/data/instructors.json`

- [ ] **Step 1:** Create `fe-admin/src/data/tenants.json`:

```json
[
  {
    "id": "yoga-sadhana",
    "slug": "yoga-sadhana",
    "name": "Yoga Sadhana",
    "plan": "growth",
    "status": "active",
    "createdAt": "2024-06-01T00:00:00.000Z"
  }
]
```

- [ ] **Step 2:** Create `fe-admin/src/data/locations.json`:

```json
[
  {
    "id": "loc-breadtalk",
    "tenantId": "yoga-sadhana",
    "name": "Yoga Sadhana @ Breadtalk IHQ",
    "shortName": "Breadtalk IHQ",
    "address": "30 Tai Seng Street #05-01, Breadtalk IHQ, Singapore 534013",
    "area": "Paya Lebar",
    "mapUrl": "https://maps.google.com/?q=Breadtalk+IHQ+Singapore",
    "rooms": 2,
    "amenities": ["Shower", "Mats provided", "Lockers"]
  },
  {
    "id": "loc-outram",
    "tenantId": "yoga-sadhana",
    "name": "Yoga Sadhana @ Outram Park",
    "shortName": "Outram Park",
    "address": "10 Eu Tong Sen Street #05-12, The Central, Singapore 059817",
    "area": "Outram",
    "mapUrl": "https://maps.google.com/?q=The+Central+Outram+Singapore",
    "rooms": 1,
    "amenities": ["Shower", "Mats provided"]
  }
]
```

- [ ] **Step 3:** Create `fe-admin/src/data/admin-users.json`:

```json
[
  {
    "id": "admin-1",
    "email": "priya@yogasadhana.sg",
    "firstName": "Priya",
    "lastName": "Menon",
    "createdAt": "2024-06-01T00:00:00.000Z"
  },
  {
    "id": "admin-2",
    "email": "arjun@yogasadhana.sg",
    "firstName": "Arjun",
    "lastName": "Rao",
    "createdAt": "2024-07-10T00:00:00.000Z"
  }
]
```

- [ ] **Step 4:** Create `fe-admin/src/data/instructors.json` with 5 instructors:

```json
[
  {
    "id": "ins-anika",
    "tenantId": "yoga-sadhana",
    "name": "Anika Shah",
    "bio": "500-hour RYT, 10+ years teaching Vinyasa and Yin.",
    "photo": "/brand/instructors/anika.jpg",
    "specialties": ["Vinyasa", "Yin", "Pranayama"],
    "availability": [
      { "dayOfWeek": 1, "startTime": "07:00", "endTime": "12:00" },
      { "dayOfWeek": 3, "startTime": "17:00", "endTime": "21:00" },
      { "dayOfWeek": 6, "startTime": "08:00", "endTime": "12:00" }
    ]
  },
  {
    "id": "ins-raj",
    "tenantId": "yoga-sadhana",
    "name": "Raj Iyer",
    "bio": "Ashtanga practitioner from Mysore lineage. Teaches disciplined, structured flows.",
    "photo": "/brand/instructors/raj.jpg",
    "specialties": ["Ashtanga", "Mysore"],
    "availability": [
      { "dayOfWeek": 2, "startTime": "06:30", "endTime": "10:00" },
      { "dayOfWeek": 4, "startTime": "06:30", "endTime": "10:00" },
      { "dayOfWeek": 5, "startTime": "18:00", "endTime": "21:00" }
    ]
  },
  {
    "id": "ins-meera",
    "tenantId": "yoga-sadhana",
    "name": "Meera Kapoor",
    "bio": "Hatha and restorative specialist. Focus on alignment and breathwork.",
    "photo": "/brand/instructors/meera.jpg",
    "specialties": ["Hatha", "Restorative"],
    "availability": [
      { "dayOfWeek": 1, "startTime": "17:00", "endTime": "21:00" },
      { "dayOfWeek": 3, "startTime": "09:00", "endTime": "13:00" },
      { "dayOfWeek": 6, "startTime": "09:00", "endTime": "13:00" }
    ]
  },
  {
    "id": "ins-devan",
    "tenantId": "yoga-sadhana",
    "name": "Devan Pillai",
    "bio": "Power yoga and core-strength. Former athlete, high-energy flows.",
    "photo": "/brand/instructors/devan.jpg",
    "specialties": ["Power", "Core"],
    "availability": [
      { "dayOfWeek": 2, "startTime": "17:00", "endTime": "21:00" },
      { "dayOfWeek": 4, "startTime": "17:00", "endTime": "21:00" },
      { "dayOfWeek": 0, "startTime": "08:00", "endTime": "12:00" }
    ]
  },
  {
    "id": "ins-lalita",
    "tenantId": "yoga-sadhana",
    "name": "Lalita Chen",
    "bio": "Prenatal and gentle yoga. Trauma-informed teaching.",
    "photo": "/brand/instructors/lalita.jpg",
    "specialties": ["Prenatal", "Gentle", "Yin"],
    "availability": [
      { "dayOfWeek": 1, "startTime": "10:00", "endTime": "13:00" },
      { "dayOfWeek": 5, "startTime": "10:00", "endTime": "13:00" }
    ]
  }
]
```

- [ ] **Step 5:** Type-check.

```bash
cd fe-admin && npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 6:** Commit.

```bash
git add fe-admin/src/data/tenants.json fe-admin/src/data/locations.json fe-admin/src/data/admin-users.json fe-admin/src/data/instructors.json
git commit -m "feat(fe-admin): seed tenants, locations, admins, instructors"
```

---

## Task 7 — Seed data: clients + products + packages

**Files:**
- Create: `fe-admin/src/data/clients.json`
- Create: `fe-admin/src/data/products.json`
- Create: `fe-admin/src/data/client-packages.json`
- Create: `fe-admin/src/data/memberships.json`

- [ ] **Step 1:** Create `fe-admin/src/data/clients.json` with 12 clients (mix of active, inactive, with/without waiver):

```json
[
  {
    "id": "cli-001",
    "tenantId": "yoga-sadhana",
    "firstName": "Aditi",
    "lastName": "Pillai",
    "email": "aditi.pillai@example.com",
    "phone": "+65 9123 4567",
    "registeredAt": "2025-06-14T08:22:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 42,
    "tags": ["regular"],
    "waiverSigned": true,
    "waiverSignedAt": "2025-06-14T08:22:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "ADITI73",
    "referredBy": null
  },
  {
    "id": "cli-002",
    "tenantId": "yoga-sadhana",
    "firstName": "Benson",
    "lastName": "Tan",
    "email": "benson.tan@example.com",
    "phone": "+65 9234 5678",
    "registeredAt": "2025-09-02T12:05:00.000Z",
    "activityStatus": "active",
    "noShowCount": 1,
    "totalSessions": 18,
    "tags": [],
    "waiverSigned": true,
    "waiverSignedAt": "2025-09-02T12:05:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "BENTN42",
    "referredBy": "cli-001"
  },
  {
    "id": "cli-003",
    "tenantId": "yoga-sadhana",
    "firstName": "Clara",
    "lastName": "Ng",
    "email": "clara.ng@example.com",
    "phone": "+65 9345 6789",
    "registeredAt": "2025-10-18T09:10:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 9,
    "tags": ["new"],
    "waiverSigned": false,
    "waiverSignedAt": null,
    "waiverVersion": null,
    "referralCode": "CLARA88",
    "referredBy": null
  },
  {
    "id": "cli-004",
    "tenantId": "yoga-sadhana",
    "firstName": "Divya",
    "lastName": "Krishnan",
    "email": "divya.k@example.com",
    "phone": "+65 9456 7890",
    "registeredAt": "2024-11-05T10:00:00.000Z",
    "activityStatus": "active",
    "noShowCount": 2,
    "totalSessions": 88,
    "tags": ["vip"],
    "waiverSigned": true,
    "waiverSignedAt": "2024-11-05T10:00:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "DIVY11",
    "referredBy": null
  },
  {
    "id": "cli-005",
    "tenantId": "yoga-sadhana",
    "firstName": "Elijah",
    "lastName": "Wong",
    "email": "elijah.wong@example.com",
    "phone": "+65 9567 8901",
    "registeredAt": "2025-12-20T14:30:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 6,
    "tags": [],
    "waiverSigned": true,
    "waiverSignedAt": "2025-12-20T14:30:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "ELIJ29",
    "referredBy": "cli-004"
  },
  {
    "id": "cli-006",
    "tenantId": "yoga-sadhana",
    "firstName": "Farah",
    "lastName": "Ibrahim",
    "email": "farah.i@example.com",
    "phone": "+65 9678 9012",
    "registeredAt": "2026-01-12T09:45:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 3,
    "tags": ["new"],
    "waiverSigned": true,
    "waiverSignedAt": "2026-01-12T09:45:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "FARA56",
    "referredBy": null
  },
  {
    "id": "cli-007",
    "tenantId": "yoga-sadhana",
    "firstName": "Gopal",
    "lastName": "Menon",
    "email": "gopal.m@example.com",
    "phone": "+65 9789 0123",
    "registeredAt": "2025-03-08T11:20:00.000Z",
    "activityStatus": "inactive",
    "noShowCount": 3,
    "totalSessions": 24,
    "tags": ["lapsed"],
    "waiverSigned": true,
    "waiverSignedAt": "2025-03-08T11:20:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "GOPA67",
    "referredBy": null
  },
  {
    "id": "cli-008",
    "tenantId": "yoga-sadhana",
    "firstName": "Hana",
    "lastName": "Choi",
    "email": "hana.choi@example.com",
    "phone": "+65 9890 1234",
    "registeredAt": "2025-08-22T13:00:00.000Z",
    "activityStatus": "active",
    "noShowCount": 1,
    "totalSessions": 31,
    "tags": [],
    "waiverSigned": true,
    "waiverSignedAt": "2025-08-22T13:00:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "HANA90",
    "referredBy": null
  },
  {
    "id": "cli-009",
    "tenantId": "yoga-sadhana",
    "firstName": "Ishaan",
    "lastName": "Reddy",
    "email": "ishaan.r@example.com",
    "phone": "+65 8123 4567",
    "registeredAt": "2024-08-03T08:15:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 104,
    "tags": ["vip"],
    "waiverSigned": true,
    "waiverSignedAt": "2024-08-03T08:15:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "ISHA14",
    "referredBy": null
  },
  {
    "id": "cli-010",
    "tenantId": "yoga-sadhana",
    "firstName": "Joanna",
    "lastName": "Lim",
    "email": "joanna.lim@example.com",
    "phone": "+65 8234 5678",
    "registeredAt": "2025-11-30T16:40:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 7,
    "tags": ["new"],
    "waiverSigned": true,
    "waiverSignedAt": "2025-11-30T16:40:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "JOAN35",
    "referredBy": "cli-009"
  },
  {
    "id": "cli-011",
    "tenantId": "yoga-sadhana",
    "firstName": "Karan",
    "lastName": "Singh",
    "email": "karan.s@example.com",
    "phone": "+65 8345 6789",
    "registeredAt": "2026-03-01T10:10:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 1,
    "tags": ["new"],
    "waiverSigned": false,
    "waiverSignedAt": null,
    "waiverVersion": null,
    "referralCode": "KARA78",
    "referredBy": "cli-001"
  },
  {
    "id": "cli-012",
    "tenantId": "yoga-sadhana",
    "firstName": "Leah",
    "lastName": "Mathew",
    "email": "leah.m@example.com",
    "phone": "+65 8456 7890",
    "registeredAt": "2025-02-14T09:00:00.000Z",
    "activityStatus": "active",
    "noShowCount": 0,
    "totalSessions": 55,
    "tags": ["regular"],
    "waiverSigned": true,
    "waiverSignedAt": "2025-02-14T09:00:00.000Z",
    "waiverVersion": "v1",
    "referralCode": "LEAH03",
    "referredBy": null
  }
]
```

- [ ] **Step 2:** Create `fe-admin/src/data/products.json`:

```json
[
  { "id": "pkg-drop", "tenantId": "yoga-sadhana", "name": "Drop-in Class", "type": "package", "creditType": "class", "price": 35, "sessionCount": 1, "expiryDays": 30, "sessionsPerMonth": null, "description": "Single class credit.", "active": true },
  { "id": "pkg-b5", "tenantId": "yoga-sadhana", "name": "Bundle of 5", "type": "package", "creditType": "class", "price": 160, "sessionCount": 5, "expiryDays": 90, "sessionsPerMonth": null, "description": "Five class credits, valid 90 days.", "active": true },
  { "id": "pkg-b10", "tenantId": "yoga-sadhana", "name": "Bundle of 10", "type": "package", "creditType": "class", "price": 290, "sessionCount": 10, "expiryDays": 120, "sessionsPerMonth": null, "description": "Ten class credits, valid 120 days.", "active": true },
  { "id": "pkg-b20", "tenantId": "yoga-sadhana", "name": "Bundle of 20", "type": "package", "creditType": "class", "price": 520, "sessionCount": 20, "expiryDays": 180, "sessionsPerMonth": null, "description": "Twenty class credits, valid 180 days.", "active": true },
  { "id": "mem-1m", "tenantId": "yoga-sadhana", "name": "Unlimited 1-Month", "type": "membership", "creditType": "class", "price": 220, "sessionCount": null, "expiryDays": 30, "sessionsPerMonth": null, "description": "Unlimited group classes for 30 days.", "active": true },
  { "id": "mem-3m", "tenantId": "yoga-sadhana", "name": "Unlimited 3-Month", "type": "membership", "creditType": "class", "price": 600, "sessionCount": null, "expiryDays": 90, "sessionsPerMonth": null, "description": "Unlimited group classes for 90 days.", "active": true },
  { "id": "pt1-5", "tenantId": "yoga-sadhana", "name": "Private 1-on-1 × 5", "type": "private-pack", "creditType": "pt", "price": 550, "sessionCount": 5, "expiryDays": 180, "sessionsPerMonth": null, "description": "Five private 1-on-1 sessions.", "active": true },
  { "id": "pt1-10", "tenantId": "yoga-sadhana", "name": "Private 1-on-1 × 10", "type": "private-pack", "creditType": "pt", "price": 1050, "sessionCount": 10, "expiryDays": 240, "sessionsPerMonth": null, "description": "Ten private 1-on-1 sessions.", "active": true },
  { "id": "ws-breath", "tenantId": "yoga-sadhana", "name": "Pranayama Breathwork Workshop", "type": "workshop", "creditType": "none", "price": 90, "sessionCount": 1, "expiryDays": null, "sessionsPerMonth": null, "description": "3-hour breathwork intensive.", "active": true },
  { "id": "ws-yin", "tenantId": "yoga-sadhana", "name": "Yin & Meditation Half-Day", "type": "workshop", "creditType": "none", "price": 110, "sessionCount": 1, "expiryDays": null, "sessionsPerMonth": null, "description": "Half-day yin immersion.", "active": true }
]
```

- [ ] **Step 3:** Create `fe-admin/src/data/client-packages.json`:

```json
[
  { "id": "cp-001", "clientId": "cli-001", "productId": "pkg-b20", "purchasedAt": "2026-02-10T08:00:00.000Z", "expiresAt": "2026-08-09T08:00:00.000Z", "creditsTotal": 20, "creditsRemaining": 12, "status": "active" },
  { "id": "cp-002", "clientId": "cli-002", "productId": "pkg-b10", "purchasedAt": "2026-03-20T09:00:00.000Z", "expiresAt": "2026-07-18T09:00:00.000Z", "creditsTotal": 10, "creditsRemaining": 6, "status": "active" },
  { "id": "cp-003", "clientId": "cli-003", "productId": "pkg-b5", "purchasedAt": "2026-04-02T10:30:00.000Z", "expiresAt": "2026-07-01T10:30:00.000Z", "creditsTotal": 5, "creditsRemaining": 4, "status": "active" },
  { "id": "cp-004", "clientId": "cli-004", "productId": "pkg-b20", "purchasedAt": "2026-01-05T12:00:00.000Z", "expiresAt": "2026-07-04T12:00:00.000Z", "creditsTotal": 20, "creditsRemaining": 3, "status": "active" },
  { "id": "cp-005", "clientId": "cli-005", "productId": "pkg-b5", "purchasedAt": "2025-12-20T14:30:00.000Z", "expiresAt": "2026-03-20T14:30:00.000Z", "creditsTotal": 5, "creditsRemaining": 0, "status": "depleted" },
  { "id": "cp-006", "clientId": "cli-006", "productId": "pkg-drop", "purchasedAt": "2026-04-18T09:00:00.000Z", "expiresAt": "2026-05-18T09:00:00.000Z", "creditsTotal": 1, "creditsRemaining": 1, "status": "active" },
  { "id": "cp-007", "clientId": "cli-008", "productId": "pkg-b10", "purchasedAt": "2026-02-01T11:00:00.000Z", "expiresAt": "2026-06-01T11:00:00.000Z", "creditsTotal": 10, "creditsRemaining": 4, "status": "active" },
  { "id": "cp-008", "clientId": "cli-009", "productId": "pt1-10", "purchasedAt": "2026-01-15T10:00:00.000Z", "expiresAt": "2026-09-12T10:00:00.000Z", "creditsTotal": 10, "creditsRemaining": 7, "status": "active" },
  { "id": "cp-009", "clientId": "cli-010", "productId": "pkg-b5", "purchasedAt": "2026-03-10T16:00:00.000Z", "expiresAt": "2026-06-08T16:00:00.000Z", "creditsTotal": 5, "creditsRemaining": 3, "status": "active" },
  { "id": "cp-010", "clientId": "cli-012", "productId": "pkg-b20", "purchasedAt": "2026-02-25T09:30:00.000Z", "expiresAt": "2026-08-24T09:30:00.000Z", "creditsTotal": 20, "creditsRemaining": 14, "status": "active" }
]
```

- [ ] **Step 4:** Create `fe-admin/src/data/memberships.json`:

```json
[
  { "id": "mem-001", "clientId": "cli-004", "productId": "mem-3m", "startsAt": "2026-03-01T00:00:00.000Z", "endsAt": "2026-05-31T23:59:59.000Z", "status": "active" },
  { "id": "mem-002", "clientId": "cli-009", "productId": "mem-1m", "startsAt": "2026-04-01T00:00:00.000Z", "endsAt": "2026-04-30T23:59:59.000Z", "status": "active" }
]
```

- [ ] **Step 5:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/data/clients.json fe-admin/src/data/products.json fe-admin/src/data/client-packages.json fe-admin/src/data/memberships.json
git commit -m "feat(fe-admin): seed clients, products, packages, memberships"
```

---

## Task 8 — Seed data: sessions, bookings, templates

**Files:**
- Create: `fe-admin/src/data/session-templates.json`
- Create: `fe-admin/src/data/sessions.json`
- Create: `fe-admin/src/data/bookings.json`

**Date anchor:** all "today" references are **2026-04-20** (the spec date). Sessions span 2026-04-13 through 2026-05-10 so the week view shows yesterday / today / upcoming / next-week.

- [ ] **Step 1:** Create `fe-admin/src/data/session-templates.json`:

```json
[
  { "id": "tpl-vin-mon-am", "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "name": "Morning Vinyasa", "category": "Vinyasa", "level": "all", "instructorId": "ins-anika", "dayOfWeek": 1, "time": "07:30", "duration": 60, "capacity": 20, "creditCost": 1, "active": true },
  { "id": "tpl-ash-tue-am", "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "name": "Ashtanga Primary", "category": "Ashtanga", "level": "intermediate", "instructorId": "ins-raj", "dayOfWeek": 2, "time": "06:45", "duration": 75, "capacity": 15, "creditCost": 1, "active": true },
  { "id": "tpl-yin-wed-pm", "tenantId": "yoga-sadhana", "locationId": "loc-outram", "name": "Yin & Restore", "category": "Yin", "level": "all", "instructorId": "ins-meera", "dayOfWeek": 3, "time": "19:00", "duration": 60, "capacity": 18, "creditCost": 1, "active": true },
  { "id": "tpl-pwr-thu-pm", "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "name": "Power Flow", "category": "Power", "level": "intermediate", "instructorId": "ins-devan", "dayOfWeek": 4, "time": "18:30", "duration": 60, "capacity": 20, "creditCost": 1, "active": true },
  { "id": "tpl-hat-fri-am", "tenantId": "yoga-sadhana", "locationId": "loc-outram", "name": "Hatha Basics", "category": "Hatha", "level": "beginner", "instructorId": "ins-meera", "dayOfWeek": 5, "time": "09:30", "duration": 60, "capacity": 18, "creditCost": 1, "active": true },
  { "id": "tpl-vin-sat-am", "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "name": "Saturday Vinyasa", "category": "Vinyasa", "level": "all", "instructorId": "ins-anika", "dayOfWeek": 6, "time": "08:30", "duration": 75, "capacity": 22, "creditCost": 1, "active": true },
  { "id": "tpl-gtl-sun-am", "tenantId": "yoga-sadhana", "locationId": "loc-outram", "name": "Gentle Sunday", "category": "Gentle", "level": "all", "instructorId": "ins-lalita", "dayOfWeek": 0, "time": "09:00", "duration": 60, "capacity": 15, "creditCost": 1, "active": true }
]
```

- [ ] **Step 2:** Create `fe-admin/src/data/sessions.json`. Includes past, today (2026-04-20 is a Monday), and future instances generated from the templates above, plus one workshop. Total: 28 rows.

```json
[
  { "id": "ses-20260413-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-mon-am", "name": "Morning Vinyasa",   "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 20, "bookedCount": 18, "waitlistCount": 0, "date": "2026-04-13", "time": "07:30", "duration": 60, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260414-ash-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-ash-tue-am", "name": "Ashtanga Primary",  "category": "Ashtanga", "level": "intermediate", "type": "regular",  "instructorId": "ins-raj",    "capacity": 15, "bookedCount": 14, "waitlistCount": 1, "date": "2026-04-14", "time": "06:45", "duration": 75, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260415-yin-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-yin-wed-pm", "name": "Yin & Restore",     "category": "Yin",      "level": "all",          "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 15, "waitlistCount": 0, "date": "2026-04-15", "time": "19:00", "duration": 60, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260416-pwr-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-pwr-thu-pm", "name": "Power Flow",        "category": "Power",    "level": "intermediate", "type": "regular",  "instructorId": "ins-devan",  "capacity": 20, "bookedCount": 17, "waitlistCount": 0, "date": "2026-04-16", "time": "18:30", "duration": 60, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260417-hat-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-hat-fri-am", "name": "Hatha Basics",      "category": "Hatha",    "level": "beginner",     "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 10, "waitlistCount": 0, "date": "2026-04-17", "time": "09:30", "duration": 60, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260418-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-sat-am", "name": "Saturday Vinyasa",  "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 22, "bookedCount": 22, "waitlistCount": 3, "date": "2026-04-18", "time": "08:30", "duration": 75, "price": 0,   "status": "completed", "recurrence": "weekly" },
  { "id": "ses-20260419-gtl-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-gtl-sun-am", "name": "Gentle Sunday",     "category": "Gentle",   "level": "all",          "type": "regular",  "instructorId": "ins-lalita", "capacity": 15, "bookedCount": 9,  "waitlistCount": 0, "date": "2026-04-19", "time": "09:00", "duration": 60, "price": 0,   "status": "completed", "recurrence": "weekly" },

  { "id": "ses-20260420-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-mon-am", "name": "Morning Vinyasa",   "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 20, "bookedCount": 14, "waitlistCount": 0, "date": "2026-04-20", "time": "07:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260420-pwr-lch", "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": null,             "name": "Lunchtime Power",   "category": "Power",    "level": "intermediate", "type": "regular",  "instructorId": "ins-devan",  "capacity": 16, "bookedCount": 11, "waitlistCount": 0, "date": "2026-04-20", "time": "12:30", "duration": 45, "price": 0,   "status": "scheduled", "recurrence": null     },
  { "id": "ses-20260420-yin-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": null,             "name": "Evening Yin",       "category": "Yin",      "level": "all",          "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 6,  "waitlistCount": 0, "date": "2026-04-20", "time": "19:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": null     },

  { "id": "ses-20260421-ash-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-ash-tue-am", "name": "Ashtanga Primary",  "category": "Ashtanga", "level": "intermediate", "type": "regular",  "instructorId": "ins-raj",    "capacity": 15, "bookedCount": 9,  "waitlistCount": 0, "date": "2026-04-21", "time": "06:45", "duration": 75, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260422-yin-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-yin-wed-pm", "name": "Yin & Restore",     "category": "Yin",      "level": "all",          "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 12, "waitlistCount": 0, "date": "2026-04-22", "time": "19:00", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260423-pwr-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-pwr-thu-pm", "name": "Power Flow",        "category": "Power",    "level": "intermediate", "type": "regular",  "instructorId": "ins-devan",  "capacity": 20, "bookedCount": 7,  "waitlistCount": 0, "date": "2026-04-23", "time": "18:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260424-hat-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-hat-fri-am", "name": "Hatha Basics",      "category": "Hatha",    "level": "beginner",     "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 4,  "waitlistCount": 0, "date": "2026-04-24", "time": "09:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260425-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-sat-am", "name": "Saturday Vinyasa",  "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 22, "bookedCount": 5,  "waitlistCount": 0, "date": "2026-04-25", "time": "08:30", "duration": 75, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260426-gtl-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-gtl-sun-am", "name": "Gentle Sunday",     "category": "Gentle",   "level": "all",          "type": "regular",  "instructorId": "ins-lalita", "capacity": 15, "bookedCount": 3,  "waitlistCount": 0, "date": "2026-04-26", "time": "09:00", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },

  { "id": "ses-20260425-ws-breath","tenantId": "yoga-sadhana", "locationId": "loc-outram",   "templateId": null,             "name": "Pranayama Workshop","category": "Workshop", "level": "all",          "type": "workshop", "instructorId": "ins-meera",  "capacity": 25, "bookedCount": 12, "waitlistCount": 0, "date": "2026-04-25", "time": "14:00", "duration": 180,"price": 90,  "status": "scheduled", "recurrence": null     },

  { "id": "ses-20260427-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-mon-am", "name": "Morning Vinyasa",   "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 20, "bookedCount": 2,  "waitlistCount": 0, "date": "2026-04-27", "time": "07:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260428-ash-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-ash-tue-am", "name": "Ashtanga Primary",  "category": "Ashtanga", "level": "intermediate", "type": "regular",  "instructorId": "ins-raj",    "capacity": 15, "bookedCount": 1,  "waitlistCount": 0, "date": "2026-04-28", "time": "06:45", "duration": 75, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260429-yin-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-yin-wed-pm", "name": "Yin & Restore",     "category": "Yin",      "level": "all",          "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 0,  "waitlistCount": 0, "date": "2026-04-29", "time": "19:00", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260430-pwr-pm",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-pwr-thu-pm", "name": "Power Flow",        "category": "Power",    "level": "intermediate", "type": "regular",  "instructorId": "ins-devan",  "capacity": 20, "bookedCount": 0,  "waitlistCount": 0, "date": "2026-04-30", "time": "18:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260501-hat-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-hat-fri-am", "name": "Hatha Basics",      "category": "Hatha",    "level": "beginner",     "type": "regular",  "instructorId": "ins-meera",  "capacity": 18, "bookedCount": 0,  "waitlistCount": 0, "date": "2026-05-01", "time": "09:30", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260502-vin-am",  "tenantId": "yoga-sadhana", "locationId": "loc-breadtalk", "templateId": "tpl-vin-sat-am", "name": "Saturday Vinyasa",  "category": "Vinyasa",  "level": "all",          "type": "regular",  "instructorId": "ins-anika",  "capacity": 22, "bookedCount": 0,  "waitlistCount": 0, "date": "2026-05-02", "time": "08:30", "duration": 75, "price": 0,   "status": "scheduled", "recurrence": "weekly" },
  { "id": "ses-20260503-gtl-am",  "tenantId": "yoga-sadhana", "locationId": "loc-outram",    "templateId": "tpl-gtl-sun-am", "name": "Gentle Sunday",     "category": "Gentle",   "level": "all",          "type": "regular",  "instructorId": "ins-lalita", "capacity": 15, "bookedCount": 0,  "waitlistCount": 0, "date": "2026-05-03", "time": "09:00", "duration": 60, "price": 0,   "status": "scheduled", "recurrence": "weekly" }
]
```

- [ ] **Step 3:** Create `fe-admin/src/data/bookings.json`. Spread bookings across the sessions above — 40 rows, realistic mix of statuses.

```json
[
  { "id": "bk-001", "clientId": "cli-001", "sessionId": "ses-20260420-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-001", "rating": null, "createdAt": "2026-04-19T08:10:00.000Z" },
  { "id": "bk-002", "clientId": "cli-002", "sessionId": "ses-20260420-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-002", "rating": null, "createdAt": "2026-04-19T09:00:00.000Z" },
  { "id": "bk-003", "clientId": "cli-004", "sessionId": "ses-20260420-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-19T10:15:00.000Z" },
  { "id": "bk-004", "clientId": "cli-008", "sessionId": "ses-20260420-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-007", "rating": null, "createdAt": "2026-04-19T11:20:00.000Z" },
  { "id": "bk-005", "clientId": "cli-012", "sessionId": "ses-20260420-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-010", "rating": null, "createdAt": "2026-04-19T12:35:00.000Z" },
  { "id": "bk-006", "clientId": "cli-001", "sessionId": "ses-20260420-pwr-lch", "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-001", "rating": null, "createdAt": "2026-04-19T14:00:00.000Z" },
  { "id": "bk-007", "clientId": "cli-009", "sessionId": "ses-20260420-pwr-lch", "status": "confirmed", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-19T15:20:00.000Z" },
  { "id": "bk-008", "clientId": "cli-002", "sessionId": "ses-20260420-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-002", "rating": null, "createdAt": "2026-04-19T16:00:00.000Z" },
  { "id": "bk-009", "clientId": "cli-003", "sessionId": "ses-20260420-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-003", "rating": null, "createdAt": "2026-04-19T17:45:00.000Z" },
  { "id": "bk-010", "clientId": "cli-010", "sessionId": "ses-20260420-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-009", "rating": null, "createdAt": "2026-04-19T18:30:00.000Z" },

  { "id": "bk-011", "clientId": "cli-001", "sessionId": "ses-20260421-ash-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-001", "rating": null, "createdAt": "2026-04-18T08:00:00.000Z" },
  { "id": "bk-012", "clientId": "cli-004", "sessionId": "ses-20260421-ash-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-18T09:00:00.000Z" },
  { "id": "bk-013", "clientId": "cli-009", "sessionId": "ses-20260421-ash-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-18T10:00:00.000Z" },

  { "id": "bk-014", "clientId": "cli-001", "sessionId": "ses-20260422-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-001", "rating": null, "createdAt": "2026-04-17T08:00:00.000Z" },
  { "id": "bk-015", "clientId": "cli-005", "sessionId": "ses-20260422-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-17T09:00:00.000Z" },
  { "id": "bk-016", "clientId": "cli-012", "sessionId": "ses-20260422-yin-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-010", "rating": null, "createdAt": "2026-04-17T10:00:00.000Z" },

  { "id": "bk-017", "clientId": "cli-002", "sessionId": "ses-20260423-pwr-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-002", "rating": null, "createdAt": "2026-04-17T11:00:00.000Z" },
  { "id": "bk-018", "clientId": "cli-008", "sessionId": "ses-20260423-pwr-pm",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-007", "rating": null, "createdAt": "2026-04-17T12:00:00.000Z" },

  { "id": "bk-019", "clientId": "cli-006", "sessionId": "ses-20260424-hat-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-006", "rating": null, "createdAt": "2026-04-19T13:00:00.000Z" },

  { "id": "bk-020", "clientId": "cli-001", "sessionId": "ses-20260425-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-001", "rating": null, "createdAt": "2026-04-15T08:00:00.000Z" },
  { "id": "bk-021", "clientId": "cli-012", "sessionId": "ses-20260425-vin-am",  "status": "confirmed", "checkInStatus": "pending",  "packageId": "cp-010", "rating": null, "createdAt": "2026-04-15T09:00:00.000Z" },

  { "id": "bk-022", "clientId": "cli-001", "sessionId": "ses-20260425-ws-breath","status": "confirmed","checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-10T10:00:00.000Z" },
  { "id": "bk-023", "clientId": "cli-003", "sessionId": "ses-20260425-ws-breath","status": "confirmed","checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-11T11:00:00.000Z" },
  { "id": "bk-024", "clientId": "cli-006", "sessionId": "ses-20260425-ws-breath","status": "confirmed","checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-12T12:00:00.000Z" },

  { "id": "bk-025", "clientId": "cli-001", "sessionId": "ses-20260413-vin-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-001", "rating": 5,    "createdAt": "2026-04-12T08:00:00.000Z" },
  { "id": "bk-026", "clientId": "cli-002", "sessionId": "ses-20260413-vin-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-002", "rating": 4,    "createdAt": "2026-04-12T09:00:00.000Z" },
  { "id": "bk-027", "clientId": "cli-004", "sessionId": "ses-20260413-vin-am",  "status": "confirmed", "checkInStatus": "no-show",  "packageId": null,     "rating": null, "createdAt": "2026-04-12T10:00:00.000Z" },

  { "id": "bk-028", "clientId": "cli-009", "sessionId": "ses-20260414-ash-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": null,     "rating": 5,    "createdAt": "2026-04-13T08:00:00.000Z" },
  { "id": "bk-029", "clientId": "cli-004", "sessionId": "ses-20260414-ash-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": null,     "rating": 4,    "createdAt": "2026-04-13T09:00:00.000Z" },

  { "id": "bk-030", "clientId": "cli-002", "sessionId": "ses-20260415-yin-pm",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-002", "rating": 5,    "createdAt": "2026-04-14T10:00:00.000Z" },
  { "id": "bk-031", "clientId": "cli-005", "sessionId": "ses-20260415-yin-pm",  "status": "confirmed", "checkInStatus": "attended", "packageId": null,     "rating": 3,    "createdAt": "2026-04-14T11:00:00.000Z" },
  { "id": "bk-032", "clientId": "cli-008", "sessionId": "ses-20260415-yin-pm",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-007", "rating": 5,    "createdAt": "2026-04-14T12:00:00.000Z" },

  { "id": "bk-033", "clientId": "cli-001", "sessionId": "ses-20260416-pwr-pm",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-001", "rating": 5,    "createdAt": "2026-04-15T10:00:00.000Z" },
  { "id": "bk-034", "clientId": "cli-012", "sessionId": "ses-20260416-pwr-pm",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-010", "rating": 5,    "createdAt": "2026-04-15T11:00:00.000Z" },

  { "id": "bk-035", "clientId": "cli-003", "sessionId": "ses-20260417-hat-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-003", "rating": 4,    "createdAt": "2026-04-16T10:00:00.000Z" },
  { "id": "bk-036", "clientId": "cli-010", "sessionId": "ses-20260417-hat-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-009", "rating": 4,    "createdAt": "2026-04-16T11:00:00.000Z" },

  { "id": "bk-037", "clientId": "cli-001", "sessionId": "ses-20260418-vin-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": "cp-001", "rating": 5,    "createdAt": "2026-04-17T10:00:00.000Z" },
  { "id": "bk-038", "clientId": "cli-004", "sessionId": "ses-20260418-vin-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": null,     "rating": 5,    "createdAt": "2026-04-17T11:00:00.000Z" },
  { "id": "bk-039", "clientId": "cli-011", "sessionId": "ses-20260419-gtl-am",  "status": "confirmed", "checkInStatus": "attended", "packageId": null,     "rating": 4,    "createdAt": "2026-04-18T10:00:00.000Z" },
  { "id": "bk-040", "clientId": "cli-007", "sessionId": "ses-20260419-gtl-am",  "status": "cancelled", "checkInStatus": "pending",  "packageId": null,     "rating": null, "createdAt": "2026-04-18T11:00:00.000Z" }
]
```

- [ ] **Step 4:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/data/session-templates.json fe-admin/src/data/sessions.json fe-admin/src/data/bookings.json
git commit -m "feat(fe-admin): seed session templates, sessions, bookings"
```

---

## Task 9 — Seed data: admin-specific entities

**Files:**
- Create: `fe-admin/src/data/private-requests.json`
- Create: `fe-admin/src/data/invoices.json`
- Create: `fe-admin/src/data/credit-adjustments.json`
- Create: `fe-admin/src/data/refunds.json`
- Create: `fe-admin/src/data/waiver-signatures.json`
- Create: `fe-admin/src/data/email-templates.json`
- Create: `fe-admin/src/data/session-cancellations.json`

**Note:** for `private-requests.json`, deadlines are computed relative to the spec date (2026-04-20). Since the admin portal uses *wall-clock* time via `Date.now()` at render, we pick `submittedAt` / `deadlineAt` values spread across the SLA tiers so the UI visibly shows green/amber/red when browsed near the seed date.

- [ ] **Step 1:** Create `fe-admin/src/data/private-requests.json`:

```json
[
  {
    "id": "req-001",
    "clientId": "cli-009",
    "preferredInstructorId": "ins-anika",
    "proposedSlots": [
      { "date": "2026-04-22", "time": "10:00" },
      { "date": "2026-04-23", "time": "10:00" },
      { "date": "2026-04-24", "time": "16:00" }
    ],
    "notes": "Working on hip mobility; recovering from a minor hamstring strain.",
    "submittedAt": "2026-04-20T06:00:00.000Z",
    "deadlineAt": "2026-04-20T18:00:00.000Z",
    "status": "pending"
  },
  {
    "id": "req-002",
    "clientId": "cli-004",
    "preferredInstructorId": "ins-raj",
    "proposedSlots": [
      { "date": "2026-04-21", "time": "07:00" },
      { "date": "2026-04-22", "time": "07:00" }
    ],
    "notes": "Prep for a retreat in May — want a primary series refresher.",
    "submittedAt": "2026-04-19T23:00:00.000Z",
    "deadlineAt": "2026-04-20T11:00:00.000Z",
    "status": "pending"
  },
  {
    "id": "req-003",
    "clientId": "cli-001",
    "preferredInstructorId": null,
    "proposedSlots": [
      { "date": "2026-04-25", "time": "14:00" },
      { "date": "2026-04-26", "time": "15:00" }
    ],
    "notes": "Birthday gift session with my partner. 2-on-1 if possible.",
    "submittedAt": "2026-04-20T04:30:00.000Z",
    "deadlineAt": "2026-04-20T16:30:00.000Z",
    "status": "pending"
  },
  {
    "id": "req-004",
    "clientId": "cli-010",
    "preferredInstructorId": "ins-meera",
    "proposedSlots": [
      { "date": "2026-04-19", "time": "14:00" }
    ],
    "notes": "One-off alignment session.",
    "submittedAt": "2026-04-18T14:00:00.000Z",
    "deadlineAt": "2026-04-19T02:00:00.000Z",
    "status": "approved",
    "resolution": {
      "resolvedAt": "2026-04-18T18:00:00.000Z",
      "resolvedBy": "admin-1",
      "scheduledDate": "2026-04-19",
      "scheduledTime": "14:00"
    }
  },
  {
    "id": "req-005",
    "clientId": "cli-008",
    "preferredInstructorId": "ins-devan",
    "proposedSlots": [
      { "date": "2026-04-16", "time": "18:00" }
    ],
    "notes": "Need a core-strength session after injury clearance.",
    "submittedAt": "2026-04-15T09:00:00.000Z",
    "deadlineAt": "2026-04-15T21:00:00.000Z",
    "status": "declined",
    "resolution": {
      "resolvedAt": "2026-04-15T14:00:00.000Z",
      "resolvedBy": "admin-2",
      "declineReason": "Instructor unavailable for proposed slot; client declined rescheduling."
    }
  }
]
```

- [ ] **Step 2:** Create `fe-admin/src/data/invoices.json`:

```json
[
  { "id": "INV-20260210-0001", "clientId": "cli-001", "issuedAt": "2026-02-10T08:00:00.000Z", "items": [{"description": "Bundle of 20", "quantity": 1, "amount": 520}], "subtotal": 520, "tax": 0, "total": 520, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-001" },
  { "id": "INV-20260320-0002", "clientId": "cli-002", "issuedAt": "2026-03-20T09:00:00.000Z", "items": [{"description": "Bundle of 10", "quantity": 1, "amount": 290}], "subtotal": 290, "tax": 0, "total": 290, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-002" },
  { "id": "INV-20260402-0003", "clientId": "cli-003", "issuedAt": "2026-04-02T10:30:00.000Z", "items": [{"description": "Bundle of 5", "quantity": 1, "amount": 160}], "subtotal": 160, "tax": 0, "total": 160, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-003" },
  { "id": "INV-20260105-0004", "clientId": "cli-004", "issuedAt": "2026-01-05T12:00:00.000Z", "items": [{"description": "Bundle of 20", "quantity": 1, "amount": 520}], "subtotal": 520, "tax": 0, "total": 520, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-004" },
  { "id": "INV-20260301-0005", "clientId": "cli-004", "issuedAt": "2026-03-01T08:00:00.000Z", "items": [{"description": "Unlimited 3-Month", "quantity": 1, "amount": 600}], "subtotal": 600, "tax": 0, "total": 600, "status": "paid", "paymentMethod": "stripe", "referenceId": "mem-001" },
  { "id": "INV-20251220-0006", "clientId": "cli-005", "issuedAt": "2025-12-20T14:30:00.000Z", "items": [{"description": "Bundle of 5", "quantity": 1, "amount": 160}], "subtotal": 160, "tax": 0, "total": 160, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-005" },
  { "id": "INV-20260418-0007", "clientId": "cli-006", "issuedAt": "2026-04-18T09:00:00.000Z", "items": [{"description": "Drop-in Class", "quantity": 1, "amount": 35}], "subtotal": 35, "tax": 0, "total": 35, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-006" },
  { "id": "INV-20260201-0008", "clientId": "cli-008", "issuedAt": "2026-02-01T11:00:00.000Z", "items": [{"description": "Bundle of 10", "quantity": 1, "amount": 290}], "subtotal": 290, "tax": 0, "total": 290, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-007" },
  { "id": "INV-20260115-0009", "clientId": "cli-009", "issuedAt": "2026-01-15T10:00:00.000Z", "items": [{"description": "Private 1-on-1 × 10", "quantity": 1, "amount": 1050}], "subtotal": 1050, "tax": 0, "total": 1050, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-008" },
  { "id": "INV-20260401-0010", "clientId": "cli-009", "issuedAt": "2026-04-01T08:00:00.000Z", "items": [{"description": "Unlimited 1-Month", "quantity": 1, "amount": 220}], "subtotal": 220, "tax": 0, "total": 220, "status": "paid", "paymentMethod": "stripe", "referenceId": "mem-002" },
  { "id": "INV-20260310-0011", "clientId": "cli-010", "issuedAt": "2026-03-10T16:00:00.000Z", "items": [{"description": "Bundle of 5", "quantity": 1, "amount": 160}], "subtotal": 160, "tax": 0, "total": 160, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-009" },
  { "id": "INV-20260225-0012", "clientId": "cli-012", "issuedAt": "2026-02-25T09:30:00.000Z", "items": [{"description": "Bundle of 20", "quantity": 1, "amount": 520}], "subtotal": 520, "tax": 0, "total": 520, "status": "paid", "paymentMethod": "stripe", "referenceId": "cp-010" },
  { "id": "INV-20260410-0013", "clientId": "cli-001", "issuedAt": "2026-04-10T10:00:00.000Z", "items": [{"description": "Pranayama Workshop", "quantity": 1, "amount": 90}], "subtotal": 90, "tax": 0, "total": 90, "status": "paid", "paymentMethod": "stripe", "referenceId": "ses-20260425-ws-breath" },
  { "id": "INV-20260411-0014", "clientId": "cli-003", "issuedAt": "2026-04-11T11:00:00.000Z", "items": [{"description": "Pranayama Workshop", "quantity": 1, "amount": 90}], "subtotal": 90, "tax": 0, "total": 90, "status": "paid", "paymentMethod": "stripe", "referenceId": "ses-20260425-ws-breath" },
  { "id": "INV-20260412-0015", "clientId": "cli-006", "issuedAt": "2026-04-12T12:00:00.000Z", "items": [{"description": "Pranayama Workshop", "quantity": 1, "amount": 90}], "subtotal": 90, "tax": 0, "total": 90, "status": "paid", "paymentMethod": "stripe", "referenceId": "ses-20260425-ws-breath" }
]
```

- [ ] **Step 3:** Create `fe-admin/src/data/credit-adjustments.json`:

```json
[
  { "id": "adj-001", "clientId": "cli-004", "packageId": "cp-004", "delta": 2,  "reason": "Make-good for class cancellation on 2026-03-15 (instructor sick).", "adminId": "admin-1", "createdAt": "2026-03-16T09:00:00.000Z" },
  { "id": "adj-002", "clientId": "cli-007", "packageId": null,     "delta": -1, "reason": "Correction: booking created by staff for wrong client.",            "adminId": "admin-2", "createdAt": "2026-03-28T14:00:00.000Z" }
]
```

- [ ] **Step 4:** Create `fe-admin/src/data/refunds.json`:

```json
[]
```

- [ ] **Step 5:** Create `fe-admin/src/data/waiver-signatures.json`:

```json
[
  { "clientId": "cli-001", "version": "v1", "signedAt": "2025-06-14T08:22:00.000Z", "status": "current" },
  { "clientId": "cli-002", "version": "v1", "signedAt": "2025-09-02T12:05:00.000Z", "status": "current" },
  { "clientId": "cli-004", "version": "v1", "signedAt": "2024-11-05T10:00:00.000Z", "status": "current" },
  { "clientId": "cli-005", "version": "v1", "signedAt": "2025-12-20T14:30:00.000Z", "status": "current" },
  { "clientId": "cli-006", "version": "v1", "signedAt": "2026-01-12T09:45:00.000Z", "status": "current" },
  { "clientId": "cli-007", "version": "v1", "signedAt": "2025-03-08T11:20:00.000Z", "status": "current" },
  { "clientId": "cli-008", "version": "v1", "signedAt": "2025-08-22T13:00:00.000Z", "status": "current" },
  { "clientId": "cli-009", "version": "v1", "signedAt": "2024-08-03T08:15:00.000Z", "status": "current" },
  { "clientId": "cli-010", "version": "v1", "signedAt": "2025-11-30T16:40:00.000Z", "status": "current" },
  { "clientId": "cli-012", "version": "v1", "signedAt": "2025-02-14T09:00:00.000Z", "status": "current" }
]
```

- [ ] **Step 6:** Create `fe-admin/src/data/email-templates.json`:

```json
[
  { "event": "booking-confirmed",    "subject": "You're in — {{session.name}} on {{session.date}}", "body": "Hi {{client.firstName}},\n\nYour booking is confirmed for {{session.name}} with {{instructor.name}} on {{session.date}} at {{session.time}} ({{session.location}}).\n\nShow the QR code in your account at check-in.\n\nNamaste,\nYoga Sadhana", "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "booking-cancelled",    "subject": "Booking cancelled — {{session.name}}",            "body": "Hi {{client.firstName}},\n\nYour booking for {{session.name}} on {{session.date}} has been cancelled. Your credit has been returned.\n\nSee you soon,\nYoga Sadhana",                                                                                                "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-purchased",    "subject": "Thanks for your purchase — {{product.name}}",     "body": "Hi {{client.firstName}},\n\nThanks for purchasing {{product.name}}. You now have {{package.creditsRemaining}} credits, valid until {{package.expiresAt}}.\n\nBook your first class anytime.\n\nYoga Sadhana",                                                          "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-30d", "subject": "30 days left on your {{product.name}}",           "body": "Hi {{client.firstName}},\n\nYour {{product.name}} expires on {{package.expiresAt}} — 30 days from now. You still have {{package.creditsRemaining}} credits to use.\n\nYoga Sadhana",                                                                                 "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-15d", "subject": "15 days left on your {{product.name}}",           "body": "Hi {{client.firstName}},\n\nHalf a month left on your {{product.name}} — {{package.creditsRemaining}} credits remaining.\n\nYoga Sadhana",                                                                                                                            "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-7d",  "subject": "7 days left on your {{product.name}}",            "body": "Hi {{client.firstName}},\n\nOne week until your {{product.name}} expires. {{package.creditsRemaining}} credits left.\n\nYoga Sadhana",                                                                                                                                  "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-1d",  "subject": "Tomorrow: your {{product.name}} expires",         "body": "Hi {{client.firstName}},\n\nYour {{product.name}} expires tomorrow. {{package.creditsRemaining}} credits remaining.\n\nYoga Sadhana",                                                                                                                                    "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-12h", "subject": "12 hours left on your {{product.name}}",          "body": "Hi {{client.firstName}},\n\nFinal countdown — 12 hours left on your {{product.name}}. {{package.creditsRemaining}} credits remaining.\n\nYoga Sadhana",                                                                                                                "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "package-expiring-2h",  "subject": "Expiring in 2 hours — {{product.name}}",          "body": "Hi {{client.firstName}},\n\nYour {{product.name}} expires in 2 hours. Last call on {{package.creditsRemaining}} credits.\n\nYoga Sadhana",                                                                                                                             "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "request-received",     "subject": "We've got your private session request",          "body": "Hi {{client.firstName}},\n\nWe've received your private-session request. We'll confirm within 12 hours.\n\nYoga Sadhana",                                                                                                                                                 "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "request-approved",     "subject": "Confirmed — private session on {{session.date}}", "body": "Hi {{client.firstName}},\n\nYour private session with {{instructor.name}} is confirmed for {{session.date}} at {{session.time}} ({{session.location}}).\n\nNamaste,\nYoga Sadhana",                                                                                       "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "request-declined",     "subject": "Couldn't fit your requested private session",     "body": "Hi {{client.firstName}},\n\nWe couldn't accommodate your request. Reason: {{decline.reason}}. Reply to this email and we'll find another slot.\n\nYoga Sadhana",                                                                                                          "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "waiver-resign",        "subject": "Please re-sign our updated waiver",                "body": "Hi {{client.firstName}},\n\nWe've updated our studio waiver. Please sign the new version before your next class.\n\nYoga Sadhana",                                                                                                                                         "updatedAt": "2026-04-01T00:00:00.000Z" },
  { "event": "workshop-reminder",    "subject": "Tomorrow: {{session.name}}",                       "body": "Hi {{client.firstName}},\n\nReminder: {{session.name}} is tomorrow at {{session.time}} ({{session.location}}). See you there.\n\nYoga Sadhana",                                                                                                                        "updatedAt": "2026-04-01T00:00:00.000Z" }
]
```

- [ ] **Step 7:** Create `fe-admin/src/data/session-cancellations.json`:

```json
[]
```

- [ ] **Step 8:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/data/private-requests.json fe-admin/src/data/invoices.json fe-admin/src/data/credit-adjustments.json fe-admin/src/data/refunds.json fe-admin/src/data/waiver-signatures.json fe-admin/src/data/email-templates.json fe-admin/src/data/session-cancellations.json
git commit -m "feat(fe-admin): seed private requests, invoices, audit logs, email templates"
```

---

## Task 10 — Mock state store

**Files:**
- Create: `fe-admin/src/lib/mock-state.ts`

- [ ] **Step 1:** Create `fe-admin/src/lib/mock-state.ts`. The store holds only the values that can change during a demo: the signed-in admin, per-session overrides (cancellations, manual bookings), check-in updates, private-request resolutions, and all audit rows. Read-only reference data (clients, instructors, products, locations, templates) is read directly from JSON by consumers and never duplicated into the store.

```ts
"use client";

import { useSyncExternalStore } from "react";
import type {
  AdminUser,
  Booking,
  CreditAdjustment,
  EmailTemplate,
  Invoice,
  PrivateRequest,
  Refund,
  Session,
  SessionCancellation,
  WaiverSignature,
} from "@/types";

import adminUsersData from "@/data/admin-users.json";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";
import privateRequestsData from "@/data/private-requests.json";
import invoicesData from "@/data/invoices.json";
import creditAdjustmentsData from "@/data/credit-adjustments.json";
import refundsData from "@/data/refunds.json";
import waiversData from "@/data/waiver-signatures.json";
import emailTemplatesData from "@/data/email-templates.json";
import sessionCancellationsData from "@/data/session-cancellations.json";

const ADMIN_USERS = adminUsersData as AdminUser[];

export type AdminState = {
  adminId: string | null;                 // currently signed-in admin
  sessions: Session[];
  bookings: Booking[];
  privateRequests: PrivateRequest[];
  invoices: Invoice[];
  creditAdjustments: CreditAdjustment[];
  refunds: Refund[];
  waivers: WaiverSignature[];
  emailTemplates: EmailTemplate[];
  sessionCancellations: SessionCancellation[];
};

const STORAGE_KEY = "admin-mock-state:v1";

function freshState(): AdminState {
  return {
    adminId: null,
    sessions: sessionsData as Session[],
    bookings: bookingsData as Booking[],
    privateRequests: privateRequestsData as PrivateRequest[],
    invoices: invoicesData as Invoice[],
    creditAdjustments: creditAdjustmentsData as CreditAdjustment[],
    refunds: refundsData as Refund[],
    waivers: waiversData as WaiverSignature[],
    emailTemplates: emailTemplatesData as EmailTemplate[],
    sessionCancellations: sessionCancellationsData as SessionCancellation[],
  };
}

const listeners = new Set<() => void>();
let cached: AdminState | null = null;

function readFromStorage(): AdminState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<AdminState>;
    const base = freshState();
    return { ...base, ...parsed };
  } catch {
    return freshState();
  }
}

function writeToStorage(state: AdminState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getState(): AdminState {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function setState(next: AdminState) {
  cached = next;
  writeToStorage(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = readFromStorage();
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const SSR_SNAPSHOT = freshState();

export function useAdminState(): AdminState {
  return useSyncExternalStore(subscribe, getState, () => SSR_SNAPSHOT);
}

// --- Mutators ---

export function signInAdmin(email: string): AdminUser | null {
  const found = ADMIN_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!found) return null;
  setState({ ...getState(), adminId: found.id });
  return found;
}

export function signOutAdmin() {
  setState({ ...getState(), adminId: null });
}

export function getCurrentAdmin(state: AdminState): AdminUser | null {
  if (!state.adminId) return null;
  return ADMIN_USERS.find((u) => u.id === state.adminId) ?? null;
}

export function resetAdminState() {
  cached = freshState();
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((l) => l());
}

// Re-export seeded admin users list for login hints etc.
export function listSeededAdmins(): AdminUser[] {
  return ADMIN_USERS;
}
```

- [ ] **Step 2:** Create `fe-admin/src/lib/mock-auth.ts`:

```ts
"use client";

import { getCurrentAdmin, signInAdmin, signOutAdmin, useAdminState } from "./mock-state";
import type { AdminUser } from "@/types";

export function useCurrentAdmin(): AdminUser | null {
  const state = useAdminState();
  return getCurrentAdmin(state);
}

export { signInAdmin, signOutAdmin };
```

- [ ] **Step 3:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/lib/mock-state.ts fe-admin/src/lib/mock-auth.ts
git commit -m "feat(fe-admin): add mock state store and auth wrappers"
```

---

## Task 11 — UI primitives: Button, Badge, Card

**Files:**
- Create: `fe-admin/src/components/ui/button.tsx`
- Create: `fe-admin/src/components/ui/badge.tsx`
- Create: `fe-admin/src/components/ui/card.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  secondary: "bg-card text-ink border border-border hover:bg-warm",
  ghost: "bg-transparent text-ink hover:bg-warm",
  danger: "bg-error text-paper hover:bg-error/90",
};

const SIZE: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5 min-h-[32px]",
  md: "text-sm px-4 py-2 min-h-[40px]",
  lg: "text-sm px-5 py-2.5 min-h-[44px]",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
```

- [ ] **Step 2:** Create `fe-admin/src/components/ui/badge.tsx`:

```tsx
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "sage" | "warning" | "error" | "cyan";

const TONE: Record<Tone, string> = {
  neutral: "bg-warm text-ink",
  accent: "bg-accent/10 text-accent-deep",
  sage: "bg-sage/15 text-sage",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  cyan: "bg-cyan/15 text-cyan-deep",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 3:** Create `fe-admin/src/components/ui/card.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg bg-card border border-border shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-6 py-4 border-b border-border", className)}>{children}</div>;
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-6 py-3 border-t border-border", className)}>{children}</div>;
}
```

- [ ] **Step 4:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/ui/button.tsx fe-admin/src/components/ui/badge.tsx fe-admin/src/components/ui/card.tsx
git commit -m "feat(fe-admin): add Button, Badge, Card primitives"
```

---

## Task 12 — UI primitives: Input, Label, Select, Textarea

**Files:**
- Create: `fe-admin/src/components/ui/input.tsx`
- Create: `fe-admin/src/components/ui/label.tsx`
- Create: `fe-admin/src/components/ui/select.tsx`
- Create: `fe-admin/src/components/ui/textarea.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
          className,
        )}
        {...rest}
      />
    );
  },
);
```

- [ ] **Step 2:** Create `fe-admin/src/components/ui/label.tsx`:

```tsx
import { type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs uppercase tracking-wider text-muted mb-1.5 block", className)}
      {...rest}
    >
      {children}
    </label>
  );
}
```

- [ ] **Step 3:** Create `fe-admin/src/components/ui/select.tsx`:

```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    );
  },
);
```

- [ ] **Step 4:** Create `fe-admin/src/components/ui/textarea.tsx`:

```tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
          className,
        )}
        {...rest}
      />
    );
  },
);
```

- [ ] **Step 5:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/ui/input.tsx fe-admin/src/components/ui/label.tsx fe-admin/src/components/ui/select.tsx fe-admin/src/components/ui/textarea.tsx
git commit -m "feat(fe-admin): add form primitives (input, label, select, textarea)"
```

---

## Task 13 — UI primitives: Table, Tabs, Modal

**Files:**
- Create: `fe-admin/src/components/ui/table.tsx`
- Create: `fe-admin/src/components/ui/tabs.tsx`
- Create: `fe-admin/src/components/ui/modal.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/ui/table.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function Table({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={cn("w-full text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-warm text-left text-xs uppercase tracking-wider text-muted">
      {children}
    </thead>
  );
}

export function TR({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-t border-border hover:bg-warm/40 transition-colors",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 text-ink", className)}>{children}</td>;
}
```

- [ ] **Step 2:** Create `fe-admin/src/components/ui/tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: string };

export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn("border-b border-border", className)}>
      <nav className="flex gap-6">
        {items.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "pb-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-accent text-accent-deep"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

- [ ] **Step 3:** Create `fe-admin/src/components/ui/modal.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 w-full max-w-lg rounded-xl bg-card shadow-modal border border-border",
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-warm hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer ? (
          <div className="px-6 py-3 border-t border-border flex justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/ui/table.tsx fe-admin/src/components/ui/tabs.tsx fe-admin/src/components/ui/modal.tsx
git commit -m "feat(fe-admin): add Table, Tabs, Modal primitives"
```

---

## Task 14 — UI primitives: EmptyState, StatCard, PageHeader, SlaChip, AuditTimeline

**Files:**
- Create: `fe-admin/src/components/ui/empty-state.tsx`
- Create: `fe-admin/src/components/ui/stat-card.tsx`
- Create: `fe-admin/src/components/ui/page-header.tsx`
- Create: `fe-admin/src/components/ui/sla-chip.tsx`
- Create: `fe-admin/src/components/ui/audit-timeline.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/ui/empty-state.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
};

export function EmptyState({ icon: Icon, title, description }: Props) {
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
    </div>
  );
}
```

- [ ] **Step 2:** Create `fe-admin/src/components/ui/stat-card.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import { Card } from "./card";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
          <p className="text-2xl font-extrabold text-ink mt-1 font-mono">{value}</p>
          {hint ? <p className="text-xs text-muted mt-1">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="h-9 w-9 rounded-full bg-accent/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-accent-deep" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3:** Create `fe-admin/src/components/ui/page-header.tsx`:

```tsx
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="text-sm text-muted mt-1 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4:** Create `fe-admin/src/components/ui/sla-chip.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { slaLabel, slaTier, type SlaTier } from "@/lib/sla";
import { cn } from "@/lib/utils";

const TONE: Record<SlaTier, string> = {
  green: "bg-sage/15 text-sage",
  amber: "bg-warning/15 text-warning",
  red: "bg-error/15 text-error",
  overdue: "bg-error text-paper",
};

export function SlaChip({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const tier = slaTier(deadlineAt, now);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tier])}>
      {slaLabel(deadlineAt, now)}
    </span>
  );
}
```

- [ ] **Step 5:** Create `fe-admin/src/components/ui/audit-timeline.tsx`:

```tsx
import { formatDateTime } from "@/lib/utils";

export type AuditEntry = {
  id: string;
  label: string;
  detail: string;
  at: string;
  by?: string;
};

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted italic">No activity yet.</p>;
  }
  return (
    <ol className="space-y-4">
      {entries.map((e) => (
        <li key={e.id} className="relative pl-6">
          <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-accent" />
          <p className="text-sm font-medium text-ink">{e.label}</p>
          <p className="text-sm text-muted">{e.detail}</p>
          <p className="text-xs text-muted mt-1 font-mono">
            {formatDateTime(e.at)}
            {e.by ? ` · ${e.by}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/ui/empty-state.tsx fe-admin/src/components/ui/stat-card.tsx fe-admin/src/components/ui/page-header.tsx fe-admin/src/components/ui/sla-chip.tsx fe-admin/src/components/ui/audit-timeline.tsx
git commit -m "feat(fe-admin): add EmptyState, StatCard, PageHeader, SlaChip, AuditTimeline"
```

---

## Task 15 — Admin sidebar

**Files:**
- Create: `fe-admin/src/components/layout/admin-sidebar.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/layout/admin-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  QrCode,
  Inbox,
  Users,
  Package as PackageIcon,
  Users2,
  MapPin,
  Receipt,
  BarChart3,
  Mail,
  FileSignature,
  Gift,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { heading: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    heading: "Operate",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/bookings", label: "Bookings", icon: ClipboardList },
      { href: "/check-in", label: "Check-in", icon: QrCode },
      { href: "/requests", label: "Requests", icon: Inbox },
    ],
  },
  {
    heading: "Manage",
    items: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/catalog/packages", label: "Catalog", icon: PackageIcon },
      { href: "/instructors", label: "Instructors", icon: Users2 },
      { href: "/locations", label: "Locations", icon: MapPin },
    ],
  },
  {
    heading: "Finance",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    heading: "Governance",
    items: [
      { href: "/notifications", label: "Notifications", icon: Mail },
      { href: "/waivers", label: "Waivers", icon: FileSignature },
      { href: "/referrals", label: "Referrals", icon: Gift },
      { href: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 flex-col border-r border-border bg-card">
      <div className="px-5 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-accent text-paper flex items-center justify-center font-extrabold text-sm">YS</span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-ink">Yoga Sadhana</span>
            <span className="text-[11px] font-mono text-muted uppercase tracking-wider">Admin</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {GROUPS.map((group) => (
          <div key={group.heading} className="px-3 mb-5">
            <p className="px-2 text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
              {group.heading}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-accent/10 text-accent-deep font-medium"
                          : "text-ink/80 hover:bg-warm hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/layout/admin-sidebar.tsx
git commit -m "feat(fe-admin): add admin sidebar with grouped navigation"
```

---

## Task 16 — Admin topbar + shell + auth guard

**Files:**
- Create: `fe-admin/src/components/layout/admin-topbar.tsx`
- Create: `fe-admin/src/components/layout/auth-guard.tsx`
- Create: `fe-admin/src/components/layout/admin-shell.tsx`

- [ ] **Step 1:** Create `fe-admin/src/components/layout/admin-topbar.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useCurrentAdmin, signOutAdmin } from "@/lib/mock-auth";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";

export function AdminTopbar() {
  const admin = useCurrentAdmin();
  const router = useRouter();

  if (!admin) return null;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between bg-paper/80 backdrop-blur border-b border-border px-6 py-3">
      <div className="text-sm text-muted">
        Signed in as <span className="text-ink font-medium">{admin.firstName} {admin.lastName}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-accent text-paper flex items-center justify-center text-xs font-bold">
            {initials(admin.firstName, admin.lastName)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            signOutAdmin();
            router.push("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2:** Create `fe-admin/src/components/layout/auth-guard.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentAdmin } from "@/lib/mock-auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const admin = useCurrentAdmin();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !admin) {
      router.replace("/login");
    }
  }, [admin, mounted, router]);

  if (!mounted) return null;
  if (!admin) return null;

  return <>{children}</>;
}
```

- [ ] **Step 3:** Create `fe-admin/src/components/layout/admin-shell.tsx`:

```tsx
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { AuthGuard } from "./auth-guard";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen flex bg-paper">
        <AdminSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <AdminTopbar />
          <main className="flex-1 px-6 py-8 max-w-[1400px] w-full mx-auto">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
```

- [ ] **Step 4:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/layout/admin-topbar.tsx fe-admin/src/components/layout/auth-guard.tsx fe-admin/src/components/layout/admin-shell.tsx
git commit -m "feat(fe-admin): add topbar, auth guard, and shell"
```

---

## Task 17 — (admin) route group + layout

**Files:**
- Create: `fe-admin/src/app/(admin)/layout.tsx`
- Delete: `fe-admin/src/app/page.tsx` (temporary stub from Task 3)
- Create: `fe-admin/src/app/page.tsx` (redirect)

- [ ] **Step 1:** Create `fe-admin/src/app/(admin)/layout.tsx`:

```tsx
import { AdminShell } from "@/components/layout/admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 2:** Replace the scaffold `fe-admin/src/app/page.tsx` with a redirect. The `(admin)/page.tsx` route (Task 19) will actually render the Dashboard at `/`. Next resolves the bracketed route first because it's more specific, so this file is effectively a placeholder kept only so the root still builds if the `(admin)` group is ever removed. For clarity, delete the temporary stub:

```bash
rm fe-admin/src/app/page.tsx
```

Note: with `(admin)/page.tsx` serving `/`, no sibling `app/page.tsx` is needed. If Next complains about missing root during build, re-add a minimal redirect file:

```tsx
// fe-admin/src/app/page.tsx — only if build requires it
import { redirect } from "next/navigation";
export default function Root() {
  redirect("/login");
}
```

- [ ] **Step 3:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/app/\(admin\)/layout.tsx fe-admin/src/app/page.tsx 2>/dev/null; git rm fe-admin/src/app/page.tsx 2>/dev/null; true
git commit -m "feat(fe-admin): add (admin) route group with shell layout"
```

---

## Task 18 — Login page

**Files:**
- Create: `fe-admin/src/app/login/page.tsx`

- [ ] **Step 1:** Create `fe-admin/src/app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInAdmin, listSeededAdmins } from "@/lib/mock-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seeded = listSeededAdmins();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = signInAdmin(email.trim());
    if (!result) {
      setError("No seeded admin with that email. Try one of the hints below.");
      return;
    }
    router.push("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-full bg-accent text-paper items-center justify-center font-extrabold mb-3">
            YS
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Yoga Sadhana Admin</h1>
          <p className="text-sm text-muted mt-1">Sign in to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-xl bg-card border border-border shadow-soft p-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@yogasadhana.sg"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <p className="text-xs text-muted mt-1 font-mono">Mockup — any password works.</p>
          </div>
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg">Sign in</Button>
        </form>
        <div className="mt-6 rounded-lg bg-warm border border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">Seeded admins</p>
          <ul className="space-y-1">
            {seeded.map((u) => (
              <li key={u.id} className="text-xs font-mono text-ink">
                {u.email} — {u.firstName} {u.lastName}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/app/login/page.tsx
git commit -m "feat(fe-admin): add login page"
```

---

## Task 19 — Dashboard page

**Files:**
- Create: `fe-admin/src/app/(admin)/page.tsx`

- [ ] **Step 1:** Create `fe-admin/src/app/(admin)/page.tsx`. The Dashboard shows today's classes, pending private-request count (with SLA breakdown), a revenue snapshot, and links to the critical workflows.

```tsx
"use client";

import Link from "next/link";
import { CalendarDays, Inbox, Receipt, Users } from "lucide-react";
import { useAdminState } from "@/lib/mock-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SlaChip } from "@/components/ui/sla-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { slaTier } from "@/lib/sla";
import { formatCurrency, formatTime, getLocationName } from "@/lib/utils";
import instructorsData from "@/data/instructors.json";
import clientsData from "@/data/clients.json";
import type { Instructor, Client } from "@/types";

const TODAY = "2026-04-20";
const instructors = instructorsData as Instructor[];
const clients = clientsData as Client[];

function instructorName(id: string): string {
  return instructors.find((i) => i.id === id)?.name ?? "—";
}
function clientName(id: string): string {
  const c = clients.find((x) => x.id === id);
  return c ? `${c.firstName} ${c.lastName}` : "—";
}

export default function DashboardPage() {
  const state = useAdminState();

  const todaySessions = state.sessions
    .filter((s) => s.date === TODAY && s.status === "scheduled")
    .sort((a, b) => a.time.localeCompare(b.time));

  const pending = state.privateRequests.filter((r) => r.status === "pending");
  const pendingRed = pending.filter((r) => {
    const t = slaTier(r.deadlineAt);
    return t === "red" || t === "overdue";
  });

  const weekStart = "2026-04-13";
  const weekEnd = "2026-04-19";
  const monthStart = "2026-04-01";
  const revToday = state.invoices
    .filter((i) => i.issuedAt.slice(0, 10) === TODAY && i.status === "paid")
    .reduce((sum, i) => sum + i.total, 0);
  const revWeek = state.invoices
    .filter((i) => {
      const d = i.issuedAt.slice(0, 10);
      return d >= weekStart && d <= weekEnd && i.status === "paid";
    })
    .reduce((sum, i) => sum + i.total, 0);
  const revMonth = state.invoices
    .filter((i) => i.issuedAt.slice(0, 10) >= monthStart && i.status === "paid")
    .reduce((sum, i) => sum + i.total, 0);

  const activeClients = clients.filter((c) => c.activityStatus === "active").length;

  return (
    <>
      <PageHeader
        title="Good morning, studio."
        description="Today's operations at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard icon={CalendarDays} label="Today's classes"       value={todaySessions.length} hint={`${todaySessions.reduce((s, x) => s + x.bookedCount, 0)} bookings`} />
        <StatCard icon={Inbox}        label="Pending requests"      value={pending.length}       hint={pendingRed.length ? `${pendingRed.length} under 2h SLA` : "All comfortable"} />
        <StatCard icon={Receipt}      label="Revenue today / week"  value={formatCurrency(revToday)} hint={`${formatCurrency(revWeek)} this week · ${formatCurrency(revMonth)} MTD`} />
        <StatCard icon={Users}        label="Active clients"        value={activeClients} hint={`${clients.length} total`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Today's classes</h2>
              <Link href="/schedule" className="text-xs font-medium text-accent-deep hover:underline">
                Full schedule →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {todaySessions.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No classes today" description="Enjoy the quiet day." />
            ) : (
              <ul className="divide-y divide-border">
                {todaySessions.map((s) => {
                  const fill = s.capacity === 0 ? 0 : Math.round((s.bookedCount / s.capacity) * 100);
                  return (
                    <li key={s.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {formatTime(s.time)} · {s.name}
                        </p>
                        <p className="text-xs text-muted">
                          {instructorName(s.instructorId)} · {getLocationName(s.locationId)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={fill >= 90 ? "error" : fill >= 70 ? "warning" : "sage"}>
                          {s.bookedCount}/{s.capacity}
                        </Badge>
                        <Link
                          href={`/schedule/${s.id}`}
                          className="text-xs font-medium text-accent-deep hover:underline"
                        >
                          Roster
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Private requests</h2>
              <Link href="/requests" className="text-xs font-medium text-accent-deep hover:underline">
                Inbox →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {pending.length === 0 ? (
              <EmptyState icon={Inbox} title="Inbox clear" description="No pending requests." />
            ) : (
              <ul className="divide-y divide-border">
                {pending.slice(0, 5).map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">{clientName(r.clientId)}</p>
                      <SlaChip deadlineAt={r.deadlineAt} />
                    </div>
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{r.notes}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 2:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/app/\(admin\)/page.tsx
git commit -m "feat(fe-admin): add dashboard page"
```

---

## Task 20 — Placeholder pages for remaining routes

**Files:**
- Create: `fe-admin/src/app/(admin)/schedule/page.tsx`
- Create: `fe-admin/src/app/(admin)/bookings/page.tsx`
- Create: `fe-admin/src/app/(admin)/check-in/page.tsx`
- Create: `fe-admin/src/app/(admin)/requests/page.tsx`
- Create: `fe-admin/src/app/(admin)/clients/page.tsx`
- Create: `fe-admin/src/app/(admin)/catalog/packages/page.tsx`
- Create: `fe-admin/src/app/(admin)/catalog/workshops/page.tsx`
- Create: `fe-admin/src/app/(admin)/catalog/classes/page.tsx`
- Create: `fe-admin/src/app/(admin)/instructors/page.tsx`
- Create: `fe-admin/src/app/(admin)/locations/page.tsx`
- Create: `fe-admin/src/app/(admin)/invoices/page.tsx`
- Create: `fe-admin/src/app/(admin)/reports/page.tsx`
- Create: `fe-admin/src/app/(admin)/notifications/page.tsx`
- Create: `fe-admin/src/app/(admin)/waivers/page.tsx`
- Create: `fe-admin/src/app/(admin)/referrals/page.tsx`
- Create: `fe-admin/src/app/(admin)/settings/page.tsx`

All placeholder pages share an identical pattern. Each signals which Phase owns it.

- [ ] **Step 1:** Create a small helper to DRY placeholder markup. File `fe-admin/src/components/ui/coming-soon.tsx`:

```tsx
import { PageHeader } from "./page-header";
import { Card, CardBody } from "./card";

export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: "Phase 2" | "Phase 3" | "Phase 4";
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody className="py-12 text-center">
          <p className="text-xs uppercase tracking-wider text-muted font-semibold">Ships in</p>
          <p className="text-3xl font-extrabold text-ink mt-1">{phase}</p>
          <p className="text-sm text-muted mt-4 max-w-md mx-auto">
            This module is scoped in the PRD at <code className="font-mono text-xs">docs/md/prd-admin.md</code>{" "}
            and will be implemented in the {phase} plan.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
```

- [ ] **Step 2:** Create 16 placeholder page files. Each is a single line of JSX.

`fe-admin/src/app/(admin)/schedule/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Schedule" description="Calendar of classes and workshops; create, edit, cancel." phase="Phase 2" />;
}
```

`fe-admin/src/app/(admin)/bookings/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Bookings" description="Flat list of all bookings across sessions with filters." phase="Phase 2" />;
}
```

`fe-admin/src/app/(admin)/check-in/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Check-in" description="QR scanner (mocked) + manual booking-ID entry." phase="Phase 2" />;
}
```

`fe-admin/src/app/(admin)/requests/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Private Session Requests" description="Inbox with 12-hour SLA countdown; approve or decline." phase="Phase 2" />;
}
```

`fe-admin/src/app/(admin)/clients/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Clients" description="Search, filter, and view client profiles with packages, bookings, and notes." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/catalog/packages/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Packages" description="Credit bundles, unlimited memberships, private-session packs." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/catalog/workshops/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Workshops" description="One-off paid events (Stripe-paid)." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/catalog/classes/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Class Templates" description="Recurring-class definitions that generate weekly sessions." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/instructors/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Instructors" description="Instructor profiles, bios, specialties, and availability." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/locations/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Locations" description="Studio locations — Breadtalk IHQ and Outram Park." phase="Phase 3" />;
}
```

`fe-admin/src/app/(admin)/invoices/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Invoices" description="Stripe-mirrored invoices with refund action." phase="Phase 4" />;
}
```

`fe-admin/src/app/(admin)/reports/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Reports" description="Attendance heatmap, revenue, package sell-through, no-show rate." phase="Phase 4" />;
}
```

`fe-admin/src/app/(admin)/notifications/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Notifications" description="Email template editor per event with live preview." phase="Phase 4" />;
}
```

`fe-admin/src/app/(admin)/waivers/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Waivers" description="Signed-waiver list and version management." phase="Phase 4" />;
}
```

`fe-admin/src/app/(admin)/referrals/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Referrals" description="Referrer + referee tracking and reward status." phase="Phase 4" />;
}
```

`fe-admin/src/app/(admin)/settings/page.tsx`:
```tsx
import { ComingSoon } from "@/components/ui/coming-soon";
export default function Page() {
  return <ComingSoon title="Settings" description="Studio profile, policies, and admin users." phase="Phase 4" />;
}
```

- [ ] **Step 3:** Type-check + commit.

```bash
cd fe-admin && npx tsc --noEmit && cd ..
git add fe-admin/src/components/ui/coming-soon.tsx fe-admin/src/app/\(admin\)/schedule fe-admin/src/app/\(admin\)/bookings fe-admin/src/app/\(admin\)/check-in fe-admin/src/app/\(admin\)/requests fe-admin/src/app/\(admin\)/clients fe-admin/src/app/\(admin\)/catalog fe-admin/src/app/\(admin\)/instructors fe-admin/src/app/\(admin\)/locations fe-admin/src/app/\(admin\)/invoices fe-admin/src/app/\(admin\)/reports fe-admin/src/app/\(admin\)/notifications fe-admin/src/app/\(admin\)/waivers fe-admin/src/app/\(admin\)/referrals fe-admin/src/app/\(admin\)/settings
git commit -m "feat(fe-admin): add placeholder pages for Phase 2–4 modules"
```

---

## Task 21 — Build verification

**Files:** none.

- [ ] **Step 1:** Full production build.

```bash
cd fe-admin && npm run build
```

Expected: build completes, all routes appear in the output summary (dashboard `/`, `/login`, and the 16 placeholders). No TypeScript errors.

- [ ] **Step 2:** Lint.

```bash
cd fe-admin && npm run lint
```

Expected: 0 errors. Warnings acceptable if justified.

---

## Task 22 — Dev-server smoke test

**Files:** none.

- [ ] **Step 1:** Start the dev server.

```bash
cd fe-admin && npm run dev
```

The server runs on `http://localhost:3100`.

- [ ] **Step 2:** Using Playwright MCP (`browser_navigate`, `browser_snapshot`), walk the following flow and confirm each step renders without runtime errors:

  1. Navigate to `http://localhost:3100/` → should redirect to `/login` (because no admin is signed in).
  2. On `/login`, enter `priya@yogasadhana.sg` and any password, submit.
  3. Expect redirect to `/` (Dashboard) showing "Good morning, studio." heading, 4 stat cards, and "Today's classes" card listing at least 3 sessions.
  4. Click sidebar link "Schedule" → expect `ComingSoon` card with "Phase 2".
  5. Click sidebar link "Reports" → expect `ComingSoon` card with "Phase 4".
  6. Click topbar "Sign out" → expect redirect back to `/login`.

- [ ] **Step 3:** If any step fails, record the console error and fix before continuing. If all pass, stop the dev server (Ctrl-C).

- [ ] **Step 4:** Commit any post-smoke fixes:

```bash
git add -A
git commit -m "fix(fe-admin): address Phase 1 smoke-test findings" || true
```

(The `|| true` keeps the step idempotent when there are no findings.)

---

## Task 23 — Vercel deploy config + README

**Files:**
- Modify: `vercel.json` (root)
- Create: `fe-admin/README.md`

- [ ] **Step 1:** Open the root `vercel.json` and confirm it still deploys `docs/html/` only. If the file currently references only `docs/html/`, leave it untouched — the admin app will be a **separate Vercel project** pointing at the `fe-admin/` directory, not a rule inside this `vercel.json`. (This mirrors how `fe/` is handled today.)

No code change is needed here; the step is documentation. If deploying via the Vercel CLI / dashboard, configure a new project:

- **Root directory:** `fe-admin`
- **Framework preset:** Next.js
- **Build command:** `npm run build` (default)
- **Output directory:** `.next` (default)

- [ ] **Step 2:** Create `fe-admin/README.md`:

```markdown
# Yoga Sadhana Admin Portal (mockup)

Clickable frontend-only admin portal for Yoga Sadhana staff. Sibling app to `../fe/`.

## Development

```bash
npm install
npm run dev         # → http://localhost:3100
```

## Seeded admins

Log in with any of the seeded emails (any password works):

- `priya@yogasadhana.sg`
- `arjun@yogasadhana.sg`

Reset the local mock state from the browser console:

```js
localStorage.removeItem("admin-mock-state:v1");
location.reload();
```

## Phase map

- **Phase 1 (shipped):** shell, login, dashboard, UI primitives, seed data, all remaining routes as `ComingSoon` placeholders.
- **Phase 2:** schedule, bookings, check-in, private-session requests.
- **Phase 3:** clients, catalog, instructors, locations.
- **Phase 4:** invoices, reports, notifications, waivers, referrals, settings.

See `../docs/md/prd-admin.md` for the product spec and `../docs/md/plans/` for phase plans.
```

- [ ] **Step 3:** Commit.

```bash
git add fe-admin/README.md
git commit -m "docs(fe-admin): add README with phase map and local-dev instructions"
```

---

## Phase 1 acceptance checklist

- [ ] `cd fe-admin && npm run build` succeeds.
- [ ] `cd fe-admin && npm run lint` returns 0 errors.
- [ ] `/login` accepts a seeded admin email and redirects to `/` Dashboard.
- [ ] Dashboard shows 4 stat cards with live-computed values (today's classes, pending requests with SLA hint, revenue snapshot, active clients).
- [ ] Sidebar navigates to all 16 grouped routes; each non-Dashboard route renders the `ComingSoon` card with the correct phase label.
- [ ] Sign-out returns to `/login` and clears `adminId` in `admin-mock-state:v1`.
- [ ] `fe/` app is untouched (no files under `fe/` modified by Phase 1).
- [ ] Design parity with `fe/`: Manrope font loaded, indigo-on-paper palette visible on every page.

---

## Phase 2–4 Preview (separate plans)

Each phase gets its own plan document when it is next up. A short preview of scope and likely task count:

### Phase 2 — Core Operations

- `/schedule` — week calendar grid (Mon–Sun columns, hour rows), session cards with fill bar, click-through to detail.
- `/schedule/[id]` — roster, actions: manual book, cancel booking, mark no-show, cancel session (writes `session-cancellations`, auto-refund via `credit-adjustments`).
- `/schedule/new` — create recurring class from template (generates 12 weeks of sessions).
- `/bookings` — flat table with filter chips (date range, status, location, instructor).
- `/check-in` — simulated camera panel + manual lookup; recent check-ins list.
- `/requests` inbox + `/requests/[id]` detail — approve (pick slot) / decline (reason).
- New state mutators: `cancelSession`, `manualBook`, `cancelBooking`, `markAttended`, `markNoShow`, `approveRequest`, `declineRequest`.
- Est. 15–18 tasks.

### Phase 3 — Clients & Catalog

- `/clients` list + `/clients/[id]` profile with tabs (Bookings, Packages, Audit).
- Credit adjustment modal writing to `credit-adjustments.json` store.
- `/catalog/packages`, `/catalog/workshops`, `/catalog/classes` — full CRUD with active/archive toggle.
- `/instructors` + `/instructors/[id]` — profile CRUD, weekly availability editor.
- `/locations` — table CRUD (seeded 2 rows editable).
- Est. 12–15 tasks.

### Phase 4 — Finance & Governance

- `/invoices` + `/invoices/[id]` — list + detail, partial/full refund action.
- `/reports` — 4 chart blocks (Recharts): attendance heatmap, revenue by product, sell-through, no-show rate.
- `/notifications` — template list + editor with mustache preview.
- `/waivers` — version bump action + signed list.
- `/referrals` — referrer and referee tables.
- `/settings` — studio profile, policy text, admin user CRUD.
- Est. 12–15 tasks.

---

## Self-Review

**Spec coverage (vs `docs/md/prd-admin.md`):**

- § 3.1 App Placement → Tasks 1–3.
- § 3.2 Design System → Task 3 (copies `globals.css` verbatim, matches Manrope + indigo palette from `fe/`).
- § 3.3 Mock Data & State → Tasks 6–10.
- § 3.4 Deployment → Task 23.
- § 4 IA (all 23 listed routes) → Tasks 18, 19, 20 (login + dashboard + 16 placeholders covers every listed route except dynamic child routes `[id]` which are Phase-2+).
- § 5 Data Model → Tasks 4 (types) + 6–9 (seed files).
- § 6 Functional Requirements — Phase 1 scope:
  - 6.1 Authentication → Tasks 10 + 18.
  - 6.2 Dashboard → Task 19.
  - 6.3–6.16 → deferred to Phase 2–4 as placeholders (Task 20).
- § 7 Cross-Cutting:
  - 7.1 Audit Trail → types + storage (Tasks 4, 9, 10); UI surfaces land with their owning modules in Phase 2–4.
  - 7.2 SLA Timers → Task 14 (SlaChip) + Task 19 (Dashboard uses it).
  - 7.3 Mock Persistence → Task 10.
  - 7.4 Design Density → Tasks 11–14 (compact defaults).
  - 7.5 Empty & Error States → Task 14 (EmptyState).
- § 8 Success Criteria → Task 22 smoke.

**Placeholder scan:** no "TBD", no "similar to task N", no "implement later". Every code step contains its code.

**Type consistency:** `AdminState`, `Session`, `Booking`, `PrivateRequest`, `CreditAdjustment`, `Refund`, `WaiverSignature`, `EmailTemplate`, `SessionCancellation`, `AdminUser` — declared once in Task 4, consumed unchanged in Tasks 10, 14, 19. Property names (`deadlineAt`, `adminId`, `creditsRemaining`, `locationId`) are consistent across JSON seed files and TS types. Store mutator names (`signInAdmin`, `signOutAdmin`, `resetAdminState`, `listSeededAdmins`, `getCurrentAdmin`, `useAdminState`) match their call sites in Tasks 16 and 18.

**Scope:** Phase 1 only. Each module page is either (a) Dashboard (built) or (b) a `ComingSoon` stub that fails fast if navigated to, so there is no silent drift between what the sidebar promises and what Phase 1 delivers.
