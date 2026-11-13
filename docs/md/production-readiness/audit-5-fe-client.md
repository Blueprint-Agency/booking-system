# Audit 5 — `fe-client/` (member app): production readiness and performance

Scope: `fe-client/` only. Read-only; no builds, dev servers or tests were run. All paths are relative to `fe-client/` unless they start with `be/`.

**Coverage.** Read in full: `next.config.ts`, `src/proxy.ts`, both layouts, every `src/lib` data/auth/tenant module, all `components/booking/*`, `components/layout/*`, `components/approvals/*`, the gates, and the account pages for bookings, overview, receipts and practice. Read by targeted extraction (every API call site, effect, timer and listener, not every JSX line): `checkout/page.tsx`, `booking/confirmation/page.tsx`, `packages/page.tsx`, `private-sessions/page.tsx`, login/register/set-password, workshops pages, `components/checkout/*`, and the remaining `components/account/*`. Bundle-size findings are SUSPECTED because no analyzer was run.

**Headline.** No finding is a P0 on its own. The risk at 100 members is the combination of F1 to F5: every page load fans out into many uncached reads, each one preflighted, with two extra reads on every navigation, and one failed read takes the whole page to the error boundary.

---

## (a) How it works

**Data layer.** There is no React Query or SWR. Three hand-rolled mechanisms coexist:

1. `lib/api.ts`: a `fetch` wrapper (`makeApi`) with a 15 s `AbortSignal.timeout` (`lib/api-request.ts:19,58`), no retries, and global handling of 401 (sign out), 403 studio refusal and 503 maintenance (`api.ts:102-108`).
2. `lib/resource-cache.ts`: a module-level `Map` cache with in-flight dedupe and stale-while-revalidate (`useCachedResource`). There is no stale time: every mount of a hook re-reads its key (`resource-cache.ts:91-105`). There is no focus refetch, no interval, and no eviction.
3. Ad-hoc `useEffect` + `useState` fetches that bypass the cache: `ClientPackagesProvider`, `useOpenPurchases`, `usePartPaymentOptions`, `useBillingDetails`, `useSavedCards`, `useCorporatePackages`, the bookings page, receipts, merch, checkout and confirmation. Several use raw `fetchApi` (`lib/api-url.ts:32`).

**Rendering.** Every page under `app/(client)` is a `"use client"` component that reads its data in the browser. The server renders only the shell. Every route is dynamic, because the root layout reads `headers()` (`lib/brand.ts:39`) and the `(client)` layout reads `cookies()` (`app/(client)/layout.tsx:14-15`). `next.config.ts:26-28` sets `staleTimes.dynamic: 30` so the router reuses an RSC payload for 30 s.

**Auth.** Better Auth client, `client` pool, bearer token in this hostname's `localStorage` (`lib/member-auth.ts:33,67-89`), `credentials: "omit"`. `memberAuth.useSession()` reads `/auth/client/get-session`. `useAppUser` reads `GET /me` once per signed-in user (`lib/auth.ts:67-71`). Pages gate themselves client-side (`components/account/account-shell.tsx:29-32`).

**Tenant resolution.** `src/proxy.ts` runs on every non-static request, strips inbound `x-tenant-*` headers, derives the slug from `Host` and resolves it through `lib/tenant.ts` (`GET /public/tenants/by-slug/:slug`, in-memory per-instance cache: 60 s fresh, 5 min stale-on-error, single-flight, 2 s deadline). The root layout calls the same memoised resolver for branding. In the browser, every API call adds `X-Tenant-Slug` from `window.location.host` (`lib/tenant-host.ts:141-145`).

**Payments.** Stripe Checkout by redirect (`window.location.href = res.url`). Stripe.js is not a dependency and is never loaded.

---

## (b) Page inventory

Global calls on every signed-in first load (not repeated per row): `GET /auth/client/get-session`, `GET /me`, `GET /me/packages`, `GET /me/approvals`. On every later client navigation: `GET /me/packages` and `GET /me/approvals` again (F2). Every route is server-dynamic with a client-only body.

| Route | API calls on load (signed in, beyond the global four) | Polling | Verdict |
|---|---|---|---|
| `/` (schedule) | `/public/locations`, `/me/class-packages`, `/public/cancellation-policy`, then `/me/classes?from&to&location_id`; ComingUp: `/me/bookings/upcoming`, `/me/bookings/past`, `/me/pt-sessions`, `/me/workshop-bookings` | approvals 60 s | 12 requests on first load, 10 on every return; 3-level waterfall; F1, F3, F6, F7 |
| `/private-sessions` | `/public/locations`, `/public/class-types`, `/public/pt-booking-config` | approvals | Fine; partner lookup fires twice (F17) |
| `/packages` | `/me/class-packages` + `/me/pt-packages` (or `/public/packages`), `/me/corporate-packages`, `/public/online-payments` | approvals | `/me/class-packages` re-read under a second cache key (F7) |
| `/checkout` | `/public/packages` or `/public/corporate-packages` or `/me/workshops/:id`, `/public/locations`, `/public/instructors`, `/me/checkout/options`, `/public/online-payments`, `/me/billing-details` | approvals | Whole catalogue for one item; instructors always read (F9) |
| `/booking/confirmation` | `POST /me/checkout/sync-session` once, `/public/packages` or `/me/workshops/:id`, `/me/checkout/options`, `/me/packages` | none (no pending poll) | Fine; catalogue over-fetch (F9) |
| `/workshops` | `/me/workshops` | approvals | Fine; cards carry `description_html` (F21) |
| `/workshops/[id]` | `/me/workshops/:id` | approvals | Fine |
| `/merch` | `/public/merch` (uncached) | approvals | Raw `<img>` (F13) |
| `/login`, `/register`, `/set-password` | none until submit; login then `GET /me` | none | Hero image hot-linked from Unsplash (F14) |
| `/account` | `/me/purchases/open`, `/me/checkout/options`, ComingUp's four | approvals | 6 uncached or revalidated reads (F6, F8) |
| `/account/bookings` | `/me/bookings/upcoming`, `/past`, `/cancelled`, `/me/pt-sessions`, `/me/workshop-bookings`, `/me/corporate-requests`, `/me/waitlist`, `/public/cancellation-policy` | approvals | 7 unpaginated lists, re-read after every mutation (F4) |
| `/account/practice` | `/me/bookings/attendance?period&on`; opening a day re-reads all six booking lists | approvals | F4 |
| `/account/packages` | `/me/purchases/open`, `/me/checkout/options`, `/public/locations`; credit history on demand | approvals | F8 |
| `/account/receipts` | `/me/receipts?from&to&page` | approvals | Paginated; no debounce (F18) |
| `/account/receipts/[id]` | `/me/receipts/:id`; PDF on click | approvals | Fine |
| `/account/billing-details` | `/me/billing-details` | approvals | Fine |
| `/account/profile` | `GET /me` again (uncached, `profile/page.tsx:73`; the top bar already holds it), then `PATCH /me` + `GET /me` on save | approvals | Duplicate `/me` (F8) |
| `/account/settings` | `/me/cards` | approvals | Fine |
| `/account/merch` | `/me/merch-orders` | approvals | Uncached, unpaginated (F8) |
| `/account/classes`, `/workshops`, `/private-sessions`, `/corporate` | redirect stubs to `/account/bookings` | n/a | Fine |
| `/impersonate`, `/stop-impersonating` | none | none | Fine |

### Polling, timer and listener inventory (complete)

| Where | Kind | Interval | Endpoint | Stops when hidden | Stops on unmount | Backoff on error |
|---|---|---|---|---|---|---|
| `components/approvals/approval-celebration.tsx:80` | `setInterval` | 60 s | `GET /me/approvals` | Yes (`:55`) | Yes (`:83-86`) | No; no jitter |
| same, `:70-72` | effect on `pathname` | every navigation | `GET /me/approvals` | Yes | n/a | No |
| same, `:81-82` | `visibilitychange` | each tab re-show | `GET /me/approvals` | n/a | Yes | No |
| `lib/use-client-packages.tsx:306-314` | effect on `pathname` | every navigation | `GET /me/packages` | No | n/a | No |
| Better Auth session (`member-auth.ts:67`, default `refetchOnWindowFocus: true` in `node_modules/better-auth/dist/client/session-refresh.mjs:13`) | `visibilitychange` + `online` | each tab re-show, 5 s floor | `GET /auth/client/get-session` | n/a | n/a | No |
| `components/maintenance-gate.tsx:26` | `setInterval` | 30 s (`lib/maintenance.ts:14`), only during maintenance | `GET /public/maintenance` | No | Yes | No; no jitter |
| `components/booking/class-row.tsx:120` | `setTimeout` 4 s | n/a | none | n/a | Yes | n/a |
| `components/booking/one-open-accordion.tsx:71` | `setTimeout` 300 ms | n/a | none | n/a | Yes | n/a |
| `components/layout/app-loader.tsx:65,74,99,114,139` | `setTimeout` (120 ms, 15 s, 0, 300 ms) | n/a | none | n/a | Yes | n/a |
| `components/layout/page-transition.tsx:41` | `setTimeout` 10 s | n/a | none | n/a | Yes | n/a |
| `app/(client)/account/profile/page.tsx:129` | `setTimeout` 3 s | n/a | none | n/a | **No** (F19) | n/a |
| `app/(client)/account/receipts/[id]/page.tsx:29` | `setTimeout` 0 | n/a | none | n/a | one-shot | n/a |
| `app/(client)/account/practice/page.tsx:240-243` | `requestAnimationFrame`, 600 ms | n/a | none | n/a | Yes | n/a |
| `lib/use-display-prefs.ts:52` | `storage` listener | n/a | none | n/a | Yes | n/a |

No SSE, no WebSocket, no `refetchInterval`. All `addEventListener` sites (`qr-badge.tsx:25,138`, `auth-gate.tsx:45`, `preferred-class-type.tsx:108`, `packages/page.tsx:144`, `scroll-to-top.tsx:23`, `view-transition-guard.tsx:20`, `receipt-document.tsx:26`, `select.tsx:91`, `use-focus-trap.ts:62`, `app-loader.tsx:80`) have matching removals.

**Steady-state polling load.** One visible signed-in tab makes 1 `GET /me/approvals` per minute. At 100 members that is 100 requests/min. Each is cross-origin with `Authorization` and `X-Tenant-Slug`, and the backend sets no preflight max-age (F1), so each poll is preceded by an `OPTIONS`: about 200 backend hits/min, 3.3/s, with nobody doing anything. During maintenance it is 2 polls/min per tab, 200/min at 100 members (400 with preflights), and it does not pause for hidden tabs.

---

## (c) Findings

### F1 — Every API call is CORS-preflighted and the backend sets no `Access-Control-Max-Age` · P1 · CONFIRMED
- **Evidence.** `src/lib/api.ts:80-90` and `src/lib/api-url.ts:33-39` add `X-Tenant-Slug` and `Authorization` to every call, including anonymous `/public/*` reads; neither header is CORS-safelisted. `be/src/app.ts:48-65` configures `cors({...})` with no `maxAge`, and a search of `be/src` finds no `maxAge` or `Access-Control-Max-Age`. Without it, browsers cache a preflight for about 5 s.
- **Load impact.** Roughly doubles the request count at the backend for anything not repeated within 5 s. The schedule's 12 reads become up to 24 hits; the idle approvals poll becomes 200/min at 100 members.
- **Fix.** Backend: add `maxAge: 86400` to the `cors()` options (Chromium caps at 2 h, Firefox at 24 h). Cross-reference with the backend auditor; this is a one-line change with the largest effect in this report.

### F2 — `/me/packages` and `/me/approvals` are re-read on every route change · P1 · CONFIRMED
- **Evidence.** `src/lib/use-client-packages.tsx:306-314` calls `load()` in an effect keyed on `pathname`. `src/components/approvals/approval-celebration.tsx:70-72` calls `check()` in an effect keyed on `pathname`. Both sit in `app/(client)/layout.tsx:18,25`, so they wrap every page.
- **Load impact.** Two authenticated reads (four hits with preflights) per navigation per member, on top of the page's own. A member tapping through five tabs makes 10 reads that almost never change. The same data is also refetched explicitly after every mutation that affects it (`cancel-booking-dialog.tsx:90`, `coming-up.tsx:243`, `bookings/page.tsx:283`, `confirmation/page.tsx:438,555`).
- **Fix.** Drop both `pathname` effects. Keep the explicit `refetch()` after mutations and add one after a successful class booking (`class-row.tsx:207`, where credits currently stay stale). Give `/me/packages` a stale time (30 to 60 s). Leave approvals to its 60 s interval and `visibilitychange`.

### F3 — The schedule page costs 12 reads on first load and 10 on every return, in a 3-level waterfall · P1 · CONFIRMED
- **Evidence.** `src/components/booking/class-feed.tsx:53-69`: `useClasses` is disabled until `/public/locations` has landed and `useCanBookClass` (`/me/class-packages`) has settled, which itself waits on the session. So: `get-session`, then locations + class-packages, then `/me/classes`. `class-feed.tsx:123` mounts `ComingUp`, which adds four more reads (F6). `resource-cache.ts:91-105` re-reads every key on every mount, so returning to `/` repeats all of them.
- **Load impact.** This is the landing page and the page members hit at booking-open time. 100 members arriving together is about 1,200 reads (2,400 hits with F1) before anyone books.
- **Fix.** (1) Add a per-key stale time to `useCachedResource` and skip the re-read inside it: 5 min for `public:*` config, 30 to 60 s for member data. (2) Start `/me/classes` in parallel: pass no `location_id` on the first read and filter client-side, or have the backend default to the member's home location. (3) Take entitlements from the `/me/packages` response the provider already holds (F7). (4) Replace ComingUp's four reads with one endpoint (F6).

### F4 — "My bookings" downloads the member's entire history in 7 unpaginated requests and re-reads all of it after every action · P1 · CONFIRMED
- **Evidence.** `src/lib/booking-sources.ts:40-54` reads `/me/bookings/upcoming`, `/past`, `/cancelled`, `/me/pt-sessions`, `/me/workshop-bookings`, `/me/corporate-requests` with no limit or cursor. `app/(client)/account/bookings/page.tsx:114-117` adds `/me/waitlist`. The whole set is merged and sorted in the browser (`:131-141`) and every row of the chosen phase is rendered with no windowing (`:271-287`). `reload()` re-runs all seven after a cancel (`:149`), after leaving a waitlist (`:166`), and after a PT cancel (`:282`). `src/components/account/practice-day.tsx:58-61,70-72` calls the same `readBookingSources` (six reads, full history) to show one day's bookings each time a day is opened.
- **Load impact.** Payload and backend query cost grow without bound with member tenure: a three-year member with 4 classes a week has about 600 past rows returned on every visit, every cancel and every day tap. This page is not cached, so every visit pays in full.
- **Fix.** Backend: one `GET /me/bookings?phase=&type=&cursor=&limit=` that returns a page plus per-phase counts (the tab badges at `:136-140` are the only reason everything is loaded). Front end: fetch the visible phase only, page "past" and "cancelled", and after a mutation update the affected row or re-read only that phase. Practice day: `GET /me/bookings?on=YYYY-MM-DD`.

### F5 — One failed read sends the whole page to the error boundary, and "Try again" re-fires every read · P1 · CONFIRMED
- **Evidence.** `src/lib/resource-cache.ts:118-121` calls `afterFailedRead`, which rethrows any error that is not 401, studio refusal or maintenance unless the caller passed `optional` (`src/lib/failed-read.ts:40-41`). The throw happens during render, so it reaches `app/error.tsx`. `useLocations` accepts an `optional` flag (`src/lib/classes.ts:182-186`) but no call site passes it; the only optional read is saved cards (`src/lib/use-saved-cards.ts:43`). `useMemberSession` also throws on a failed session read (`src/lib/member-auth.ts:149-153`). There is no handling of 429 or `Retry-After` anywhere in `src`. `error.tsx:43` retries by re-rendering, which re-runs every hook on the page.
- **Load impact.** With 12 reads per schedule load, a 1% backend error rate fails roughly 11% of page loads outright. A 429 from a rate limiter or a 15 s timeout on a single config read blanks the schedule. Each member who presses "Try again" resends the full set, which is the manual equivalent of a retry storm against a backend that is already struggling.
- **Fix.** Treat config reads (`cancellation-policy`, `online-payments`, `pt-booking-config`, `instructors`, `class-types`) as optional with inline fallbacks. In `sendApiRequest`, retry idempotent GETs once on 429/502/503/504 and network failure with jittered backoff, honouring `Retry-After`. Never auto-retry POST or DELETE. Keep the last good cached value on a failed revalidation (already done) and show an inline retry for the failed section only.

### F6 — "Up next" reads four full lists, including all past bookings, to show one ticket · P1 · CONFIRMED
- **Evidence.** `src/components/account/coming-up.tsx:174-190` reads `/me/bookings/upcoming`, `/me/bookings/past`, `/me/pt-sessions` and `/me/workshop-bookings`, then picks one item (`:86-114`). It is mounted on the schedule (`class-feed.tsx:123`) and on `/account` (`account/page.tsx:46`), and revalidates on every mount.
- **Load impact.** Four of the schedule page's 12 reads, with `/past` unbounded (F4). This is the most-visited page.
- **Fix.** Backend: `GET /me/next-booking` returning the single next class, PT session or workshop. Until then, drop `/me/bookings/past` (it is only used to catch a class in progress; `upcoming` can include in-progress rows) and apply the stale time from F3.

### F7 — `/me/class-packages` is fetched for entitlements the app already has, and again under a second cache key · P2 · CONFIRMED
- **Evidence.** `src/lib/classes.ts:253-255` reads `/me/class-packages` under key `me:{id}:class-entitlements` and keeps only `entitlements`. `src/lib/packages.ts:88-95` reads the same endpoint under key `packages:{id}`. The two keys do not share a request or a value. `GET /me/packages`, already loaded by the provider, returns an `entitlements` object too (`src/lib/use-client-packages.tsx:119-133`).
- **Load impact.** One redundant full-catalogue read per schedule visit, plus a second copy when the member opens `/packages`.
- **Fix.** Derive `canBook` and `entitlements` from `ClientPackagesProvider` (extend `/me/packages` entitlements with the few fields that differ), or share one cache key and one fetcher between the two hooks.

### F8 — Six data hooks bypass the cache, so they show a spinner and refetch on every mount · P2 · CONFIRMED
- **Evidence.** `useOpenPurchases` (`src/lib/open-purchases.ts:47-77`), `usePartPaymentOptions` (`:88-127`, a per-studio setting read on `/account`, `/account/packages`, `/checkout` and `/booking/confirmation`), `useBillingDetails` (`src/lib/billing-details.ts:134-167`), `useSavedCards` (`src/lib/use-saved-cards.ts:17-56`), `useCorporatePackages` (`src/lib/corporate.ts:53-91`), `ClientPackagesProvider` (raw `fetchApi`, `use-client-packages.tsx:261`), and the merch pages (`merch/page.tsx:27-29`, `account/merch/page.tsx:32-43`). `useBillingDetails` is re-read each time a `BillingDetailsPicker` mounts (`billing-details-picker.tsx:43`: checkout, the add-on checkout, and every `BillToSheet` opened from a buy button).
- **Load impact.** No dedupe between sibling components and no reuse across navigations. Three parallel data-fetching styles also make F3's fix land in only one of them.
- **Fix.** Move all of them onto `useCachedResource` (with the stale time from F3), or adopt TanStack Query once and delete `resource-cache.ts`. Either way, one mechanism.

### F9 — Checkout and confirmation download the whole catalogue to find one item, and checkout always reads instructors · P2 · CONFIRMED
- **Evidence.** `app/(client)/checkout/page.tsx:186-198` fetches `/public/packages` and filters by id; `:175-180` does the same with `/public/corporate-packages`; `booking/confirmation/page.tsx:563-571` repeats it. All use raw `fetchApi`, so the catalogue the member just browsed (`usePackagesCatalog`) is not reused. `checkout/page.tsx:137` calls `useInstructors()` unconditionally, though it is needed only when `isBoundPt` (`:136`).
- **Load impact.** Two to three avoidable reads on the purchase path.
- **Fix.** Read the item from the cached catalogue, falling back to a `GET /public/packages/:id`. Pass `enabled: isBoundPt` to the instructors read.

### F10 — Opening a class and booking it reads `/me/classes/:id` twice; cancelling from a row reads the whole upcoming list · P2 · CONFIRMED
- **Evidence.** `src/components/booking/class-detail-overlay.tsx:119` and `src/components/booking/confirm-booking-sheet.tsx:84` each call `fetchMemberClass` on mount with no shared cache; the overlay's "Book Now" closes it and opens the sheet (`class-row.tsx:615-618`). `class-row.tsx:334-339` fetches `/me/bookings/upcoming` and searches it for one `class_id`; `cancel-booking-dialog.tsx:61-64` then fetches `/me/bookings/:id` for the preview.
- **Load impact.** The booking tap path is the hot path at release time: 2 reads before the POST instead of 1, and 2 before a cancel instead of 1.
- **Fix.** Cache the class detail by id for a few seconds and share it. Include `booking_id` on the class card when `is_booked` is true so the row can open the cancel dialog directly.

### F11 — Every route is rendered dynamically for a shell that is identical for all members of a studio · P2 · CONFIRMED (cost SUSPECTED)
- **Evidence.** `next.config.ts:20-25` states it. Causes: `src/lib/brand.ts:39` reads `headers()` in the root layout, and `app/(client)/layout.tsx:14-15` plus `components/impersonation-banner.tsx:16-17` read `cookies()` for a staff-only impersonation banner. `src/proxy.ts:86-90` runs on every document and RSC request, including `<Link>` prefetches. Pages carry no server data.
- **Load impact.** Each navigation and prefetch is a proxy invocation plus a server render on Vercel. That is cost and latency, not backend load, because the tenant lookup is cached per instance. Measure function invocations per session before sizing this.
- **Fix.** Detect impersonation on the client (the grant cookie is already read there, `lib/impersonation-handoff.ts:29-31`) to remove the `cookies()` read. Then make the shell cacheable per tenant: have the proxy rewrite to `/s/[slug]/...` and use `generateStaticParams`/ISR (`revalidate: 60`), or wrap `getBrand` in a cached function keyed by slug.

### F12 — No request is aborted on unmount, key change or fast navigation · P2 · CONFIRMED
- **Evidence.** A search of `src` for `AbortController` returns no non-test match. Cancellation is a `cancelled` flag that only drops the response (`resource-cache.ts:93-104`, `class-detail-overlay.tsx:137-143`, `receipts/page.tsx:44-52`). `makeApi`'s `get/post/patch/del` do not accept a signal (`api.ts:114-121`).
- **Load impact.** Switching location on the schedule, stepping through practice periods or paging receipts leaves every superseded request running to completion on the backend.
- **Fix.** Thread an `AbortSignal` through `makeApi` and `useCachedResource`; abort in effect cleanup, combined with the timeout via `AbortSignal.any`.

### F13 — Avatars and merch images are raw `<img>` at full upload size, with no lazy loading · P2 · CONFIRMED
- **Evidence.** `src/components/ui/avatar.tsx:37-42` renders a bare `<img>` with no `loading`, `decoding`, `width` or `height`. Uploads are 512 px (`src/lib/square-crop.ts:29`) and are drawn at 20 to 56 px. One avatar renders per class row, and all 10 days of rows are mounted (F15). `app/(client)/merch/page.tsx:74-80` does the same for product images; its comment says R2 hosts are not in `remotePatterns`, but `cdn.reservetoday.app` is (`next.config.ts:48-51`).
- **Load impact.** The schedule requests every instructor photo for 10 days up front at roughly 100 times the needed pixel count. Bandwidth and CDN cost; not backend load.
- **Fix.** Add `loading="lazy" decoding="async"` and explicit dimensions to `Avatar`. Serve a small variant (store a 96 px rendition at upload, or use `next/image` with `sizes`). Use `next/image` on merch.

### F14 — The sign-in page's hero is hot-linked from Unsplash; placeholder hosts are allowed in production · P2 · CONFIRMED
- **Evidence.** `src/components/auth/auth-split-shell.tsx:22,31-36` renders `img(imageKey)` from `src/data/images.ts:28-46`, whose URLs are `images.unsplash.com/...&w=1920`. `public/images/` holds only `.gitkeep`, so every `local` path in that file points at nothing. `next.config.ts:31-42` allows `images.unsplash.com`, `placehold.co` and `placeholder.co` in the image optimiser.
- **Load impact.** Sign-in, register and set-password depend on a third party's availability and hot-link terms, and each studio pays an optimiser transformation for the same stock photo. Seven of the nine entries in `images.ts` are unused.
- **Fix.** Commit the two or three images actually used into `public/images/` (or make the auth image a tenant setting), delete the rest of `data/images.ts`, and remove the three hosts from `remotePatterns`.

### F15 — Ten days of class rows stay mounted, each carrying about 17 state hooks and all dialogs statically imported · P2 · CONFIRMED (render cost SUSPECTED)
- **Evidence.** `src/components/booking/one-open-accordion.tsx:137-150` keeps closed panels mounted. `class-feed.tsx:168-183` renders a `ClassRow` for every class in the 10-day window (`:28`). Each `ClassRow` has 17 `useState` calls, two focus traps and a scroll lock (`class-row.tsx:90-136`) and resets six of them during render when its `cls` prop identity changes (`:125-133`), which happens for every row on each background revalidation. There is no `next/dynamic` or `React.lazy` anywhere in `src`; `class-row.tsx:41-45` statically imports five dialogs.
- **Load impact.** A studio with 15 classes a day mounts about 150 rows. Each revalidation of `/me/classes` re-renders all of them twice. Client CPU on low-end phones; measure with the React profiler.
- **Fix.** Mount only the open day's rows (render children when `isOpen`, or after first open). Lift dialog state to one instance per feed. Load `ClassDetailOverlay`, `ConfirmBookingSheet`, `BookedCelebration` and `CancelBookingDialog` with `next/dynamic`. Wrap `ClassRow` in `React.memo` and keep row object identity stable across revalidations when nothing changed.

### F16 — `"lint": "next lint"` with no ESLint config; the hook rules the code disables are never run · P2 · CONFIRMED
- **Evidence.** `package.json` has `"lint": "next lint"` and `eslint` as a dev dependency. Neither `fe-client/` nor the repo root contains an `eslint.config.*` or `.eslintrc*`, and `next lint` was removed in Next 16 (`"next": "^16.3.4"`). The source carries `eslint-disable-line react-hooks/exhaustive-deps` comments (`use-client-packages.tsx:314`, `account/merch/page.tsx:42`, `account/receipts/page.tsx:54`, `account/receipts/[id]/page.tsx:63`, `class-row.tsx:187`, `select.tsx:120`, `lib/corporate.ts:87`), so the rule was once expected to run.
- **Load impact.** None directly. Stale-closure and missing-cleanup bugs, the class behind most findings here, have no automated check.
- **Fix.** Add a flat `eslint.config.mjs` with `eslint-config-next` and `react-hooks`, change the script to `eslint .`, and run it in CI beside `tsc`.

### F17 — Partner lookup fires twice per check and has no in-flight guard · P3 · CONFIRMED
- **Evidence.** `app/(client)/private-sessions/page.tsx:457` runs `runPartnerLookup` on the email input's `onBlur`; `:463` runs it on the button's `onClick`. Clicking the button blurs the input first, so both fire. `runPartnerLookup` (`:135-157`) has no pending flag and no sequence check, so a slow first answer can overwrite a newer one.
- **Fix.** Guard with a `looking` flag and skip when the email equals the last one looked up.

### F18 — Receipt date filters fetch on every change with no debounce · P3 · CONFIRMED
- **Evidence.** `app/(client)/account/receipts/page.tsx:42-55` fetches on each `from`/`to` change; superseded responses are dropped but not aborted (F12).
- **Fix.** Debounce by about 300 ms, or fetch on blur.

### F19 — Profile "saved" timer is never cleared · P3 · CONFIRMED
- **Evidence.** `app/(client)/account/profile/page.tsx:129`: `setTimeout(() => setSaved(false), 3000)` with no handle kept.
- **Fix.** Hold the handle in a ref and clear it on unmount and before re-arming.

### F20 — The maintenance recheck has no jitter and does not pause when hidden; recovery reloads every tab at once · P3 · CONFIRMED
- **Evidence.** `src/components/maintenance-gate.tsx:24-32`: fixed 30 s `setInterval`, no visibility check, and `window.location.reload()` on the first success.
- **Load impact.** When maintenance ends, every open tab reloads within the same 30 s and issues its full first-load set (F3): at 100 members about 1,200 reads, twice that with preflights, hitting a backend that has just come back.
- **Fix.** Add ±50% jitter per tab, skip while hidden, and delay the reload by a random 0 to 10 s.

### F21 — Smaller items · P3
- **Session refetch on focus.** Better Auth's default `refetchOnWindowFocus` re-reads `get-session` on each tab re-show, at the same moment as the approvals check (`approval-celebration.tsx:81`). A 401 on any call already signs the member out (`api.ts:104`), so set `sessionOptions: { refetchOnWindowFocus: false }` in `member-auth.ts:67`. CONFIRMED.
- **Cache never evicts.** `resource-cache.ts:17-18` keeps every key for the life of the tab, including one per practice period and anchor and one per location per day. Small per entry; cap it or clear `me:*` keys on sign-out. CONFIRMED.
- **Telemetry on every page.** `src/lib/telemetry.ts:23` statically imports `@grafana/faro-web-sdk` from `instrumentation-client.ts`, so it ships in the first-load bundle even where no collector URL is set. Load it with a dynamic `import()` when the URL exists. SUSPECTED size.
- **Console noise.** `src/lib/report-error.ts:12` logs every reported error with `console.error` in production, including each 5xx and network failure from `api-request.ts:62,85`. CONFIRMED.
- **No idempotency key on money and booking POSTs.** `POST /me/bookings/class` (`class-row.tsx:195`) and `POST /me/checkout/*` (`checkout/page.tsx:285`, `buy-button.tsx:98`) send none. After a 15 s client timeout the button re-enables and a second tap creates a second request. Buttons are correctly disabled while in flight. SUSPECTED; depends on backend dedupe. Cross-reference with the member API auditor.
- **Workshop cards carry `description_html`** (`src/lib/workshops.ts:59`); the list does not need the full HTML body. SUSPECTED payload size.
- **Proxy matcher** includes `/(api|trpc)(.*)` (`src/proxy.ts:89`); the app has neither.
- **No bundle analyzer** and no `poweredByHeader: false` in `next.config.ts`.
- **CSP** allows `'unsafe-inline'` scripts (`src/lib/security-headers.ts:44`); flagged for the security auditor.

---

## (d) Checked and fine

- **No retry storms from the client.** `api-request.ts` never retries; one request, one 15 s deadline.
- **In-flight dedupe** inside `useCachedResource` (`resource-cache.ts:30-45`); late responses for an old key are dropped (`:93-100`).
- **Schedule cache keys are stable.** `feedWindow` rounds `from`/`to` to the studio's midnight (`lib/schedule-days.ts:16-21`), so the classes key does not change per mount.
- **Approvals poll** pauses when the tab is hidden, has an in-flight guard, and is cleared on unmount and sign-out (`approval-celebration.tsx:54-87`).
- **Checkout confirmation does not poll.** `sync-session` is posted once per load (`confirmation/page.tsx:103-128`); corporate sync is guarded by a ref (`corporate-request-sent.tsx:42-44`).
- **Double-submit protection** on every mutating button: book (`class-row.tsx:192,479`), confirm sheet (`confirm-booking-sheet.tsx:250`), pay (`pay-button.tsx:21`), buy (`buy-button.tsx` `busy`), cancel (`cancel-booking-dialog.tsx:156`), PT cancel, leave waitlist, billing save, stop impersonating.
- **Tenant resolution on the server** is cached, single-flight, deadline-bounded and serves stale on outage (`lib/tenant.ts:82-108`); `generateMetadata` and the layout reuse the same memoised lookup, so there is no duplicate backend call per request.
- **Brand context** is a server-resolved constant per request and does not re-render the tree. `ClientPackagesProvider`'s value is memoised (`use-client-packages.tsx:327-344`).
- **`GET /me`** is read once per signed-in user, not per navigation (`lib/auth.ts:67-71`).
- **Stripe.js is not loaded anywhere**; checkout is a redirect.
- **Dependencies are lean**: no moment, lodash, date or chart library. `lucide-react` is imported by name in all 59 files. `react-phone-number-input` is imported only by the register page and `qrcode.react` only by `qr-badge.tsx`.
- **Font** is self-hosted through `next/font` (`app/layout.tsx:16`).
- **`localStorage`** holds three fixed keys (session token, display prefs, unsynced flag); no growth.
- **Receipts are paginated server-side** (`lib/receipts.ts:72-77`, `receipts/page.tsx:47`).
- **Workshop and auth images use `next/image`** with `sizes` (`workshops/page.tsx:184-188`, `workshops/[id]/page.tsx:190-194`).
- **Listeners, observers and rAF loops** all have cleanups (see the inventory above); the one exception is F19.
- **401, tenant refusal and maintenance** are handled centrally with late-response guards (`member-auth.ts:123-132`).
- **Security headers** (HSTS, nosniff, frame-ancestors, Permissions-Policy) are set on every response (`lib/security-headers.ts:62-74`).
