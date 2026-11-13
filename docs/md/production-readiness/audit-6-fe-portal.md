# Audit 6 — `fe-portal/` (staff portal: admin + instructor + super portal)

Read-only audit. Paths are relative to `fe-portal/src/` unless they start with `fe-portal/`. Line numbers are from `main` at `99acbbab`.
Nothing was built, run or measured: every finding marked SUSPECTED needs a network-tab or profiler measurement before it is sized.

**Headline:** nothing here is a P0 at 10 concurrent staff. The portal makes no automatic retries, has a 15 s deadline on every request, handles 401 and maintenance centrally, and its only all-day poll is one cheap-looking request a minute. The real costs are (1) there is no client data layer at all, so every mount, every mutation and (on Finance) every keystroke is a fresh uncached request, often for a whole table; (2) a handful of mutation flows refetch 5-7 endpoints each time; (3) several "status=all" lists are downloaded whole and grow without bound; (4) money-moving POSTs share the 15 s abort with no idempotency key.

---

## (a) How it works

**Data layer.** There is no query library (no React Query / SWR; `fe-portal/package.json:11-25` lists 13 runtime deps). Everything goes through one fetch wrapper:

- `lib/api.ts:56-103` `apiFetch` — reads the bearer token, adds `X-Tenant-Slug` from the hostname (`tenantRequestHeaders()`), `cache: "no-store"`, throws `ApiError` on non-2xx. `makeApi()` (`:109-122`) binds it to `get/post/patch/put/del`.
- `lib/api-request.ts:53-93` `sendApiRequest` — `AbortSignal.timeout(15_000)` by default (`:20`, `:61`), 10 min for `FormData` (`:27`); reports 5xx/network errors to Faro. **No retry, no backoff, no dedupe, no cache.**
- Reads are hand-rolled per page: `useState` + `useCallback(load)` + `useEffect(load)`. Two small helpers exist: `lib/use-read.ts` (loading/loaded/failed with a `cancelled` flag, used by 3 call sites) and `lib/use-schedule.ts` (sequence-number guard). Neither aborts the superseded request; a stale answer is only ignored when it lands.
- The only cache is `lib/catalog.ts:24-36`: a module-level `Map` of promises with a 60 s TTL for instructors / rooms / locations / class types.
- After a mutation, pages call their own `load()` again (whole-resource refetch). There is no optimistic concurrency token anywhere (`grep` for `If-Match|version|etag` finds none in request code).

**Auth.** Better Auth bearer token in `localStorage` per origin (`lib/portal-auth.ts:45-76`), `credentials: "omit"`. `portalAuth.useSession()` (`:198`) is Better Auth's store; it is created with no `sessionOptions` (`:83-117`), so the library default `refetchOnWindowFocus = true` applies (`node_modules/better-auth/dist/client/session-refresh.mjs:13`, rate-limited to once per 5 s, `:9`). A 401 on a call that carried a token clears the token and both shells redirect to `/login?next=…` (`lib/session-expiry.ts`, `lib/portal-auth.ts:143-155`). A `503 {error:"maintenance"}` swaps the whole app for a maintenance screen (`components/layout/maintenance-gate.tsx`).

**Shell.** `app/admin/layout.tsx` and `app/instructor/layout.tsx` each mount `WorkspaceProvider` (`lib/workspace-context.tsx:129`) → `AdminShell`/`InstructorShell` → `AttentionProvider`. On mount the provider calls `GET /portal/auth/me` (`:212`), then for admins `GET /portal/admin/locations?include_archived=true` (`:306`). The active location lives in `localStorage` (`rt.activeLocationId`).

**Tenant resolution.** `proxy.ts` (Next 16 middleware) runs on every non-asset request (`:105-112`), strips inbound `x-tenant-*`, resolves the slug via `GET /public/tenants/by-slug/:slug` (`lib/tenant.ts:85-131`) with an in-memory 60 s fresh / 5 min stale cache and in-flight dedupe (`:44-83`), and sets `x-tenant-id`/`x-tenant-slug` request headers. The root layout calls the same `resolveTenant` twice more per render via `getBrand()` (`app/layout.tsx:21` and `:34`). In the browser the slug is re-derived from `window.location.host` for every API call.

**Rendering.** Root layout awaits `headers()` (`app/layout.tsx:37`), so every route is dynamically rendered on every request. 55 of 58 pages are `"use client"`; the server renders only the shell + brand, and all data is fetched in the browser after hydration. Cold-load waterfall: proxy tenant lookup → HTML → JS → Better Auth `get-session` → `/portal/auth/me` → `/portal/admin/locations` + `/portal/attention/summary` → the page's own reads. Three serial round trips before the first page-specific request.

---

## (b) Inventories

### Page inventory

All routes: dynamic server shell, client-only content. "Shell" = `get-session`, `/portal/auth/me`, `/portal/admin/locations?include_archived=true` (admin only), `/portal/attention/summary` — fired once per hard load, and summary again on every route change.

| Route | API calls on load (after shell) | Polling | Verdict |
|---|---|---|---|
| `/admin/schedule` | `/portal/admin/instructors` (uncached, `app/admin/schedule/page.tsx:96`), `/portal/admin/schedule?from&to&location_id` | none | No abort on week stepping; type/instructor filter client-side (fine); month view unmemoised; every event is a prefetching `<Link>` (F-08) |
| `/admin/schedule/class/[id]` | class detail + instructors + class-types + rooms (catalog cache), then children: `/portal/admin/schedule/series/:id`, `/portal/leave-calendar?from=to`, `/portal/admin/feature-flags`, `/portal/admin/class-packages` | none | Whole page unmounts and all of these re-fire on every roster/waitlist/save action (F-02) |
| `/admin/schedule/pt/[id]`, `/corporate/[id]` | detail + instructors + rooms (`[type]/[id]/page.tsx:601`, `:966`) | none | Same unmount-on-reload pattern |
| `/admin/schedule/new/class`, `/new/series`, `/new/workshop`, `/workshop/[id]/edit` | catalog trio + leave-calendar + feature-flags + class-packages (+ workshop detail) | none | OK; cached trio |
| `/admin/customers` | `/portal/admin/clients?q&filter&sort&page&page_size` | none | Server-paged, debounced, seq-guarded — good. Imports phone-input lib eagerly (F-13) |
| `/admin/customers/[id]` | `/portal/admin/clients/:id` (one monolithic profile) | none | Client-side paging of 6 lists from one payload; full reload after every action (F-06) |
| `/admin/check-in`, `/instructor/check-in` | `/portal/{admin,instructor}/check-in[?location_id&date]` — whole day, every session with its roster | 60 s refetch, 30 s clock | Poll never pauses when hidden; whole day refetched after each scan/tick (F-04) |
| `/admin/finance` | instructors + locations (cache), `/portal/admin/finance/overview`, `/portal/admin/finance` | none | Search fires per keystroke, no race guard, whole ledger client-paged, save refetches both (F-01) |
| `/admin/receipts`, `/receipts/[id]` | `/portal/admin/receipts?…page` | none | Server-paged, debounced — good |
| `/admin/purchases` | `/portal/admin/purchases/silent` | none | Whole list, client-paged (bounded by nature) |
| `/admin/leave` | `/portal/admin/leave?status=all`; calendar tab: `/portal/leave-calendar?from&to` | none | Every request ever, unpaged, no row cap (F-05) |
| `/admin/my-leave`, `/instructor/leave` | own leave (`components/leave/my-leave.tsx:101`) | none | OK |
| `/admin/pt-requests` | `/portal/admin/pt-sessions?status=all&location_id` | none | Whole history, client tabs + paging (F-05) |
| `/instructor/pt-requests` | `/portal/instructor/pt-requests` | none | Whole queue, client location filter |
| `/admin/corporate-requests` | `/portal/admin/corporate-requests?status=<tab>` (+ one `/:id` for a deep link) | none | No seq guard on tab switch (F-07) |
| `/admin/staff` | `/portal/admin/staff` | none | Small; OK |
| `/admin/policy` | `/portal/admin/policy` + `/portal/admin/staff` | none | Two PATCHes in `Promise.all` on save (`policy/page.tsx:242-252`) — non-atomic |
| `/admin/classes`, `/class-types`, `/rooms`, `/merch`, `/private-sessions`, `/packages/corporate`, `/packages/promo-codes`, `/locations`, `/emails`, `/feature-flags`, `/business-details`, `/profile` | one list/read each | none | Small catalogues, client-paged — fine |
| `/admin/classpass` | `/portal/admin/classpass`, `/portal/admin/classpass/review` | 10 s while setup is incomplete | Pauses when hidden; no stop condition if setup is abandoned (F-04) |
| `/instructor/schedule` | `/portal/instructor/schedule?from&to` | none | Same calendar code as admin |
| `/instructor/schedule/class/[id]`, `/pt/[id]` | roster read | none | Keeps the page during re-reads (`class/[id]/page.tsx:72`) — the pattern admin should copy |
| `/instructor/payroll`, `/profile` | one read each | none | OK |
| `/platform` | `/platform/tenants`, `/platform/imports` | 1.5 s per running import | In-flight guard; only while an import runs; not paused when hidden |
| `/platform/maintenance` | `/platform/maintenance` | none | OK |
| `/login`, `/signup`, `/confirm-email` | Better Auth / public endpoints | 1 s UI countdown only | OK |

### Polling / timer inventory (complete — every `setInterval`, recurring `setTimeout`, focus/visibility listener; no SSE or WebSocket exists)

| # | Where | Interval | Endpoint | Pauses when hidden | Cleared on unmount | Error backoff |
|---|---|---|---|---|---|---|
| T1 | `components/attention/attention-provider.tsx:128` | 60 s | `GET /portal/attention/summary[?location_id]` | Yes (`:126`) | Yes (`:132`) | None |
| T2 | same, `:129-130` | on `visibilitychange` **and** `focus` | same | n/a | Yes | None; both events fire on tab return → 2 requests |
| T3 | same, `:118-120` | every route change (`pathname` dep) | same | n/a | n/a | None |
| T4 | `lib/portal-auth.ts:83` (Better Auth default) | every window focus, max 1 per 5 s | `GET /portal/auth/staff/get-session` (pool path from `lib/auth-pool.ts`) | n/a | library-managed | None |
| T5 | `components/check-in/check-in-desk.tsx:219` | 60 s | `GET /portal/{admin,instructor}/check-in` (whole day + rosters) | **No** | Yes (`:222`) | None (quiet failure) |
| T6 | `components/check-in/check-in-desk.tsx:227` | 30 s | none (re-render clock) | No | Yes | — |
| T7 | `components/check-in/qr-scanner.tsx:161-175` | self-rescheduling `setTimeout` (`SCAN_INTERVAL_MS`) | none (local decode) | No (camera + decode keep running) | Yes (`halt`, `:200-203`) | — |
| T8 | `app/admin/classpass/page.tsx:77` | 10 s (`lib/classpass.ts:76`) | `GET /portal/admin/classpass` (+ `/classpass/review` when mail arrived) | Yes (`:78`) | Yes | None; runs for as long as setup is incomplete |
| T9 | `app/platform/page.tsx:334` | 1.5 s (`:53`) | `GET /platform/tenants/:id/imports/latest` × running imports | No | Yes | In-flight guard only |
| T10 | `components/layout/maintenance-gate.tsx:28` | 30 s, only during maintenance | `GET /public/maintenance` (anonymous) | No | Yes | Fixed |
| T11 | `components/auth/portal-login.tsx:113` | 1 s, only during resend countdown | none | — | Yes | — |
| T12 | `components/layout/app-loader.tsx` | one-shot timers | none | — | Yes | — |
| T13 | search debounces: `customers/page.tsx:165`, `receipts/page.tsx:83`, `class-roster.tsx:406` (250 ms), `pt-seat.tsx:198` (250 ms), `create-tenant-dialog.tsx:105`, `rename-tenant-dialog.tsx:50` | one-shot | search endpoints | — | Yes | — |

**Requests per minute, per admin, from background machinery alone**

| State | T1 | T2+T4 | T3 | T5 | Total |
|---|---|---|---|---|---|
| Idle visible tab, any page | 1 | 0 | 0 | 0 | **1/min** |
| Working (4 navigations/min, 2 tab returns/min) | 1 | 2×(2 summary + 1 get-session) = 6 | 4 | 0 | **~11/min** |
| Front-desk tab on Check-in, visible | 1 | 0 | 0 | 1 | **2/min** (+1 per scan/tick) |
| Check-in tab left in the background | 0 | 0 | 0 | 1 | **1/min, all day, unseen** |
| ClassPass page during setup | 1 | 0 | 0 | — | **7/min** |

×10 staff: roughly 10/min idle, ~110/min when everyone is actively navigating (≈1.8 req/s). That is not a capacity problem on its own. What matters is the cost of two endpoints the backend auditors should size: **`GET /portal/attention/summary`** (called ~80 % of the above; it aggregates open items across leave, PT requests, corporate requests, purchases, ClassPass review, check-ins) and **`GET /portal/{admin,instructor}/check-in`** (every session of the day with every roster row, for every open desk tab, visible or not).

---

## (c) Findings

### P1 — real cost or risk at the target load

**F-01 · P1 · CONFIRMED — Finance: a request per keystroke, no race guard, whole ledger downloaded, and every pay-cell save refetches ledger + analytics**
- `app/admin/finance/page.tsx:409` `onChange={(e) => setQ(e.target.value)}` → `filters` memo (`:140-143`) → `load` (`:185-200`) → `GET /portal/admin/finance`. No debounce. Customers and Receipts already debounce (`customers/page.tsx:165`); Finance does not.
- `load` has no sequence guard and no abort: the answer for "ab" can land after "abc" and be drawn as the result. It also does `setData(null)` (`:190`), so the table blanks on each keystroke.
- The ledger is not paged by the server: `rows.slice(...)` at `:222-225`. "All time" downloads every finance row the studio has.
- `saveAmount` → `reload()` (`:251`) → `Promise.all([load(), loadOverview()])` (`:207-209`). Entering pay for 40 sessions costs 40 × (PATCH + full ledger + `GET /portal/admin/finance/overview`, which the code's own comment calls "four analytics queries", `:168-169`). Same for `handleDeleteManual` (`:269`).
- CSV export uses `api.get` with the default 15 s deadline (`lib/finance.ts:316`, `lib/api-request.ts:20`); an all-time export that takes longer is aborted in the browser while the backend finishes it.
- Load impact: the heaviest read endpoints in the portal, multiplied by typing speed and by data-entry volume. Backend cross-ref: `GET /portal/admin/finance`, `/finance/overview`, `/finance/export`.
- Fix: debounce `q` (300 ms) and guard with a sequence number or `AbortController`; server-side pagination (`page`, `page_size`, `total`) as Customers has; after a pay save, patch the row in place from the PATCH response and refetch only totals (or nothing); give the export its own long deadline or stream it via `downloadFile`.

**F-02 · P1 · CONFIRMED — Admin class detail unmounts and refetches 5-7 endpoints after every roster, waitlist or save action**
- `app/admin/schedule/[type]/[id]/page.tsx:121-141` `load()` sets `loading = true`; `:162` `if (loading) return <LoadingDetail/>` replaces the whole page. `ClassRoster`, `WaitlistPanel`, `SeriesPanel` and `ClassEditor` all receive `onChanged={load}` / `onSaved={load}` (`:211`, `:227`, `:234`, `:246`).
- Remounting re-runs every child's mount read: `getSeries` (`components/schedule/series-panel.tsx:61-71`), `GET /portal/leave-calendar` (`components/schedule/instructor-leave.tsx:51-53`), `GET /portal/admin/feature-flags` via `useWaitlistsOn` (`lib/use-waitlists-on.ts:15-25`, `lib/class-waitlist.ts:200-203`), `GET /portal/admin/class-packages` via `PackageRuleField` (`lib/package-rule.ts:200-204`), plus the class detail itself and three catalog reads (cached 60 s).
- Side effects: the page flashes to a spinner and loses scroll position on each added member; unsaved edits in `ClassEditor` are discarded (and the re-sync effect at `:302-319` would overwrite them even without the unmount).
- The instructor page already does it right: `app/instructor/schedule/class/[id]/page.tsx:72` `if (loading && !data)`.
- Same pattern on PT and corporate detail (`:601`, `:966`) and on the customer profile (F-06).
- Load impact: adding 20 walk-ins to a class = 20 × ~5 uncached GETs instead of 20 × 1.
- Fix: show the spinner only on first load; on change, refetch just the class detail (or apply the mutation's response); hoist feature flags and the class-package catalogue into the 60 s catalog cache.

**F-03 · P1 · CONFIRMED (client side) / SUSPECTED (outcome depends on backend) — Money-moving and bulk POSTs share the 15 s abort and carry no idempotency key**
- Every non-upload request is abandoned at 15 s (`lib/api-request.ts:20`, `:61`; `lib/api.ts:93`). The backend is not told; it carries on.
- Affected writes include refunds (`app/admin/customers/[id]/page.tsx:916`, `:938`, `:1042`; `app/admin/purchases/page.tsx:227`), package issue (`:975`), staff bookings and overbooks (`lib/class-seats.ts:96`), series create/extend that make many classes (`lib/series.ts:119`, `:127`), PT scheduling (`components/pt-requests/schedule-from-request-dialog.tsx:247-253`).
- No request sends an idempotency key (`grep -i idempoten` over `src/` returns nothing). Buttons are guarded while the request is in flight (e.g. `components/clients/refund-dialog.tsx:63-71`), but after a timeout the dialog re-enables and the natural next action is to press again.
- Load impact: exactly when the backend is slow (the scenario this audit targets), staff retry writes that may already have succeeded. Refunds call Stripe, so 15 s is reachable.
- Fix: longer deadline for known-slow writes; a client-generated `Idempotency-Key` header on every non-GET, honoured by the backend; on a timeout, say "this may still have gone through — check before retrying" and re-read the entity. Cross-ref backend: refund, booking, series, and PT-schedule handlers.

**F-04 · P1 · CONFIRMED — Polls have no backoff, and the check-in poll runs in hidden tabs**
- Check-in: `components/check-in/check-in-desk.tsx:219` fires every 60 s with no `document.hidden` check (compare `attention-provider.tsx:126`). A desk tab left open behind another window reads the whole day's rosters all day. The same full read also runs after each scan (`:256`) and each manual tick (`:319`), although the tick already patched local state (`:299-318`).
- Attention: fixed 60 s regardless of failures (`attention-provider.tsx:109-114` swallows and waits for the next tick). `visibilitychange` and `focus` both call `tick` (`:129-130`), so returning to the tab sends two identical requests; the sequence guard at `:88` discards one answer but both hit the backend.
- ClassPass: 10 s poll for as long as setup is incomplete (`app/admin/classpass/page.tsx:69-87`); a studio that enables ClassPass and never finishes setup polls at 6/min whenever the page is visible.
- No handling of 429 or `Retry-After` anywhere in `lib/api.ts`; a rate-limited poll keeps its cadence.
- Load impact: small per tab, but these are the requests that continue when the backend is degraded, from every open tab.
- Fix: one shared `usePoll(fn, ms)` that skips when hidden, de-dupes focus/visibility within ~2 s, doubles the interval on failure up to a cap, honours `Retry-After`, and stops after N minutes of ClassPass setup with a "Check again" button. Drop the post-tick full reload on check-in.

**F-05 · P1 (grows with time) · CONFIRMED — "status=all" lists are downloaded whole and filtered/paged in the browser**
- `app/admin/leave/page.tsx:120-123` `GET /portal/admin/leave?status=all` — "Fetch every status once; the tabs filter client-side" (`:114`). No `usePaged` on this page: every row is rendered.
- `app/admin/pt-requests/page.tsx:60-63` `GET /portal/admin/pt-sessions?status=all&location_id=…`, then client tabs + `usePaged` (`:93`).
- `app/instructor/pt-requests/page.tsx:62` whole queue for every location, filtered by location in the browser (`:77-85`).
- `app/admin/corporate-requests/page.tsx:117-120` whole tab, `usePaged` (`:159`).
- `app/admin/finance/page.tsx:222-225` (see F-01).
- The same picker endpoints are read whole inside dialogs: `components/schedule/pt-request-picker-dialog.tsx:49-52`, `corporate-request-picker-dialog.tsx:53`.
- Load impact: fine on day one; payload and backend query grow linearly with the studio's history, and these are pages staff open many times a day.
- Fix: server pagination + per-status counts in the response (the reason given for fetching everything is honest tab counts — return `counts: {pending, approved, …}` alongside one page). Default the "all/history" tabs to a date window.

**F-06 · P1 · CONFIRMED — Customer profile is one monolithic read, refetched in full after every action**
- `app/admin/customers/[id]/page.tsx:430-448` one `GET /portal/admin/clients/:id` returning packages, past packages, upcoming / past (capped at 50, `:294`) / cancelled bookings, payments, workshop purchases, open purchases (`:274-302`). Six sections page it client-side (`:1279`, `:1503`, `:1573`, `:2034`, `:2102`). `cancelled_bookings`, `payments` and `past_packages` have no cap.
- `runEdit` (`:454-472`) and `runRefund` (`:506`) call `load()` after any of ~15 actions; `load` sets `loading = true` (`:432`).
- Fix: keep the page mounted on re-read; split history sections into lazily loaded, server-paged reads (`/clients/:id/bookings?state=cancelled&page=…`); let mutations return the changed package/booking.

**F-07 · P1 · CONFIRMED — Unguarded reads can paint the wrong data after a fast filter/tab/location change**
- No sequence guard or abort in: `app/admin/finance/page.tsx:185-200` (per keystroke), `app/admin/corporate-requests/page.tsx:112-130` (tab), `app/admin/pt-requests/page.tsx:51-72` (workspace location), `app/instructor/payroll/page.tsx:26-41` (date range), `app/admin/finance/page.tsx:170-179` (overview range).
- The guarded ones (`lib/use-schedule.ts:52`, `customers/page.tsx:147`, `components/leave-calendar.tsx:120`, `check-in-desk.tsx:190`) only ignore the stale answer; none cancels the request (`AbortController` appears nowhere in `src/`), so stepping five weeks on the calendar runs five full schedule queries on the backend.
- Fix: one `useRead`-style hook used everywhere that passes an `AbortSignal` into `apiFetch` (it already accepts `signal`, `lib/api.ts:40`) and aborts on key change/unmount. Note `sendApiRequest` drops the 15 s deadline when a caller passes a signal (`api-request.ts:61`) — combine them with `AbortSignal.any`.

**F-08 · P1 (Vercel cost) · SUSPECTED — every calendar event and list row is a prefetching `<Link>`**
- `components/schedule/schedule-calendar.tsx:832-836` (week/day blocks), `:376-385` (month chips), plus list rows and ~20 sidebar links (`components/layout/sidebar.tsx:107`). No `prefetch={false}` anywhere in `src/`.
- All routes are dynamic (root layout reads `headers()`), and `app/admin/loading.tsx:4-6` exists precisely so that their fallbacks are prefetchable. In production each distinct `href` entering the viewport triggers an RSC prefetch that passes through `proxy.ts` and a function invocation. A week with 100 sessions is ~100 prefetches per week step, none of which carries data (pages are client components).
- Needs measurement in a production build (Network tab, filter `_rsc`).
- Fix: `prefetch={false}` on calendar blocks, list rows and table links; keep it on the sidebar.

**F-09 · P1 · CONFIRMED — No protection against two staff editing the same thing**
- Class edit sends the full form (`app/admin/schedule/[type]/[id]/page.tsx:321-…`, `lib/schedule.ts:329`), as do PT/corporate session edits (`lib/schedule.ts:347`, `:356`), policy (`app/admin/policy/page.tsx:242-252`), locations (`lib/workspace-context.tsx:388`), finance pay cells (`lib/finance.ts:343`). No version / `updated_at` precondition is sent by any of them.
- Nothing refreshes an open detail page, so an admin who opened a class at 09:00 and saves at 09:30 writes back 09:00's instructor, room and capacity over whatever a colleague changed.
- Fix: send only changed fields (the page already computes a `ClassPatch`), and add an `updated_at` precondition the backend answers with 409 → "This class changed — reload".

### P2 — waste / best practice

**F-10 · P2 · CONFIRMED — No shared read cache; identical reads repeat on every mount**
- `GET /portal/admin/instructors` is fetched directly by the Schedule page (`app/admin/schedule/page.tsx:96-98`) although the 60 s catalog cache holds the same path (`lib/catalog.ts:57-60`). Returning from a class to the Schedule refetches instructors and the week.
- `GET /portal/admin/feature-flags` and `/portal/admin/class-packages` are refetched by every form mount (see F-02). `/portal/admin/staff` is read by both Staff and Policy.
- Locations are read three ways: inside `/portal/auth/me` (`workspace-context.tsx:213`), `/portal/admin/locations?include_archived=true` (`:306`), and `/portal/admin/locations` in the catalog (`catalog.ts:92`).
- The catalog cache is never invalidated after a write (`clearCatalogCache` is exported "for future explicit invalidation", `catalog.ts:26-29`, and never called outside tests), so a new instructor/room is missing from pickers for up to 60 s.
- Fix: adopt one small query cache (TanStack Query, or extend `cachedGet` with keys + invalidation + abort) and route every read through it; `staleTime` 30-60 s for catalogues, invalidate on the matching write.

**F-11 · P2 · CONFIRMED — `WorkspaceContext` value is rebuilt on every render**
- `lib/workspace-context.tsx:457-482` builds `value` as a fresh object literal (no `useMemo`), including `allStaff: currentStaff ? [currentStaff] : []` (a new array each time).
- The provider re-renders on every navigation (`usePathname`, `:139`) and whenever Better Auth's session store notifies (each focus refetch, T4). Every `useWorkspace()` consumer — effectively every component in the app — then re-renders, including an unmemoised calendar.
- Fix: `useMemo` the value; split the stable part (`api`, `currentStaff`, `may`) from the volatile part (`activeLocationId`, location lists) into two contexts.

**F-12 · P2 · CONFIRMED structure / SUSPECTED cost — Calendar has no memoisation**
- No `React.memo` anywhere in `src/`. `MonthView` filters all entries once per day cell — 42 × N calls to `startsOnDay` → `Intl.DateTimeFormat.formatToParts` (`schedule-calendar.tsx:299-301`, `lib/studio-time.ts:105-123`); `WeekView` 7 × N (`:236`); `layoutEvents` re-sorts per column per render (`:620-628`). All of it re-runs on any `SchedulePage` state change (opening the filter row, arming "+ Class", hover-free state toggles) and on every context change from F-11.
- Arming "+ Class" mounts 36 slot buttons × 7 days (`SlotLayer`, `:445-476`), 252 extra nodes; fine.
- No virtualisation; the List view renders every open week's rows (`schedule-list-view.tsx:52-63`). Acceptable at a month of sessions.
- Fix: bucket entries by local day once in a `useMemo` (as `lib/schedule-list.ts:29-36` already does for the List), `memo` `EventBlock`, and pass stable `resolver`.

**F-13 · P2 · CONFIRMED — No code-splitting of dialogs/editors; one heavy lib loaded eagerly**
- `next/dynamic` / `React.lazy` appear nowhere. `react-phone-number-input` (ships libphonenumber metadata) and its CSS are imported at the top of the Customers list (`app/admin/customers/page.tsx:8-9`) though only the Add Customer dialog uses them.
- Large single-file client pages: `customers/[id]/page.tsx` 2,169 lines with ~15 dialogs imported statically; `schedule/[type]/[id]/page.tsx` 1,381; `check-in-desk.tsx` 1,174; `staff/page.tsx` 1,033.
- `@grafana/faro-web-sdk` is initialised at startup with all web instrumentations (`lib/telemetry.ts:35-41`); SUSPECTED: its performance instrumentation reports every fetch, including each poll, to the collector all day — check Grafana Cloud ingest volume and consider sampling.
- Good: `jsqr` is dynamically imported only when `BarcodeDetector` is missing (`components/check-in/qr-scanner.tsx:56`); `lucide-react` uses named imports; `date-fns` is imported in one file (`lib/formatters.ts:1`).
- Fix: `dynamic(() => import(...), { ssr: false })` for the Add Customer dialog and the profile's action dialogs, workshop editor, promo-code editor, QR scanner.

**F-14 · P2 · CONFIRMED — Session re-validated on every window focus**
- `lib/portal-auth.ts:83-117` leaves Better Auth's `refetchOnWindowFocus` at its default `true`. Each alt-tab back to the portal costs a `get-session` (DB session lookup) on top of the attention read(s).
- Fix: `sessionOptions: { refetchOnWindowFocus: false }`; the 401 relay (`lib/session-expiry.ts`) already ends a dead session on the next API call.

**F-15 · P2 · CONFIRMED — Member typeahead uses the full paginated list endpoint**
- `lib/class-seats.ts:228-239`: Add-member search (class roster and PT seat, debounced 250 ms, min 2 chars) calls `GET /portal/admin/clients?q=…&filter=active&sort=name&page=1&page_size=10`, the same handler that computes `total` (and the trials funnel) for the Customers page.
- Fix: a lean `/portal/admin/clients/search?q=` with `LIMIT 10` and no count; raise debounce to ~300 ms and abort the previous request. Cross-ref backend: cost of the count on `clients` for a prefix search.

**F-16 · P2 · CONFIRMED — Downloads bypass the API client**
- `lib/download.ts:16-43`: raw `fetch` with no deadline, no 401 → session-expiry relay, no maintenance relay, and the whole file (a studio archive, a member export) buffered into a Blob in memory.
- `lib/finance.ts:316-326` revokes the object URL synchronously after `click()`, which `download.ts:40-42` itself notes can cancel the download in some browsers.
- Fix: route through a shared helper with a long deadline and the relays; prefer a short-lived signed URL (the pattern `openSignedUrl` already uses, `lib/api.ts:131-141`) so large files stream to disk.

**F-17 · P2 · CONFIRMED — Admin and instructor surfaces duplicate code**
- `app/admin/schedule/new/class/page.tsx` (485 lines) vs `app/instructor/schedule/new/class/page.tsx` (400): 271 differing lines after normalising the role name; the rest is copy.
- `app/admin/schedule/page.tsx` vs `app/instructor/schedule/page.tsx`: same toolbar, range, filter, add-mode and picker wiring, re-typed (`ADD_KINDS`, `clearAdd`, `arm`, `pickSlot`).
- Two shells (`admin-shell.tsx`, `instructor-shell.tsx`) and two navs differ only in the nav list and one redirect. Class/PT detail pages exist twice with different reload behaviour (see F-02).
- Risk: fixes land on one surface only — F-02 is an example.
- Fix: one `NewClassForm`, `SchedulePage` and `Shell` parameterised by role.

**F-18 · P2 · CONFIRMED — Hard-load waterfall and triple tenant lookup**
- Serial chain before any page data: `get-session` → `/portal/auth/me` → locations/attention → page read (`workspace-context.tsx:272-296`, `:322-324`).
- `resolveTenant` is called in the proxy (`proxy.ts:46`) and twice in the root layout (`app/layout.tsx:21`, `:34`); deduped only by a per-instance in-memory map, which on serverless is cold often and may not be shared between the proxy and render bundles.
- The tenant cache `Map` (`lib/tenant.ts:54`) is never pruned: every distinct subdomain probed, including unknown ones, stays for the life of the instance.
- Fix: wrap `getBrand` in React `cache()`; pass the brand from the proxy via a header or use `unstable_cache`/`fetch` revalidate (60 s) instead of a hand-rolled map; cap the map; fire the page's first read in parallel with `/auth/me` once a token exists.

**F-19 · P2 · CONFIRMED — Every route is dynamic and client-only**
- `app/layout.tsx:37` reads `headers()` in the root layout, so nothing is static, including `/login`, `/signup` and `not-found`. 55 of 58 pages are `"use client"` and render nothing on the server but a spinner.
- Not a backend cost, but each navigation is a function invocation plus a proxy run on Vercel for no server-rendered content.
- Fix (optional): accept it, but then disable prefetch broadly (F-08); or move brand/tenant to a cookie/header-free path so shells can be static.

**F-20 · P2 · CONFIRMED — CSP allows inline script while the session token sits in `localStorage`**
- `lib/security-headers.ts:50` `script-src 'self' 'unsafe-inline'`; token in `localStorage` (`lib/portal-auth.ts:45-76`). Any injected markup that executes can read an admin token. Raised here because it is a production-readiness item; the auth auditor owns the decision.
- Fix: nonce-based CSP (Next supports it from the proxy).

### P3 — nits

- **F-21 · CONFIRMED** — `NowIndicator` reads the time once (`schedule-calendar.tsx:554`) and "today" is computed at render; a tab left open overnight shows yesterday's now-line and today-highlight until something re-renders. The schedule itself never auto-refreshes, so an all-day tab shows the bookings counts from whenever the week was last loaded.
- **F-22 · CONFIRMED** — QR camera and decode loop keep running while the tab is hidden (`qr-scanner.tsx:161-175`); stop on `visibilitychange` to save battery on desk tablets.
- **F-23 · CONFIRMED** — Raw `<img>` for avatars, logo and merch with no `loading="lazy"`, `width`/`height` or `next/image` (`components/ui/avatar.tsx:47`, `components/brand/studio-mark.tsx:51`, `app/admin/merch/page.tsx:181`, `components/profile/profile-picture-field.tsx:199`). `next.config.ts` has no `images` block. Rosters with many avatars load full-size originals.
- **F-24 · CONFIRMED** — Dead code: `switchStaff`, `updateStaffGrants`, `allStaff` "compat no-ops" in the context (`workspace-context.tsx:105-108`, `:439-440`, `:478`) with no consumers; `DevRoleSwitcher` is the production user menu under a dev name; create-next-app assets in `fe-portal/public/` (`next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`) are unreferenced.
- **F-25 · CONFIRMED** — `app/admin/schedule/workshop/[id]/edit/page.tsx:31` casts the workshop read to `any`.
- **F-26 · CONFIRMED** — Policy save issues two PATCHes in `Promise.all` (`app/admin/policy/page.tsx:242-252`); one can succeed and the other fail, leaving a half-saved policy with a single error toast.
- **F-27 · CONFIRMED** — `reportError` logs every failure to `console.error` in production (`lib/report-error.ts:12`), including each failed poll.
- **F-28 · CONFIRMED** — Platform import poll (1.5 s, T9) and maintenance recheck (T10) do not pause when hidden. Low volume; fold into the shared poll helper from F-04.

---

## (d) Checked and fine

- **No retry storms from the client**: `apiFetch` never retries; `useRead.retry` and "Try again" buttons are manual.
- **Every request has a deadline** (15 s / 10 min uploads), and timeouts/5xx are reported with the backend `requestId` (`lib/api-request.ts`).
- **401 handling** is central and correct, including the late-401-for-an-old-token case (`lib/portal-auth.ts:143-155`); **maintenance 503** is central (`lib/maintenance.ts`).
- **Failed reads are never drawn as empty data** (`lib/failed-read.ts`), consistently applied.
- **Timers and listeners are cleaned up**: every `setInterval`/`addEventListener` found has a matching cleanup in its effect; no leak found for an all-day tab. The loader hold counter (`lib/loading-store.ts`) is balanced by effect cleanup.
- **Storage is bounded**: `localStorage` holds one token, one location id, two UI flags; `sessionStorage` holds two schedule positions and one auto-open marker per token. No growth.
- **In-memory caches are bounded** in the browser: the catalog map has six possible keys.
- **`/portal/auth/me` is fetched once per hard load**, not per navigation (`workspace-context.tsx:293-296`).
- **Customers and Receipts lists**: server pagination, 250-300 ms debounce, sequence guard, position kept in the URL.
- **Schedule range reads** are bounded to the visible day/week/month and location; type/instructor filtering in the browser is cheap and avoids refetches.
- **Double-submit guards** exist on the destructive dialogs sampled (refund, block, delete, archive, cancel, roster `busyId`, check-in `scanningRef` + scan gate).
- **Check-in scan path** is single-flight (`check-in-desk.tsx:249-250`) and de-duplicates repeated reads of the same QR (`createScanGate`).
- **Fonts**: `next/font` Manrope, self-hosted, one family (`app/layout.tsx:13`).
- **Bundle deps are lean**: no calendar, chart, xlsx, PDF or rich-text libraries; one date lib; icons via named imports; `jsqr` lazy.
- **Proxy**: inbound `x-tenant-*` headers are stripped on every path; tenant lookup has a 2 s timeout, in-flight dedupe and stale-while-unavailable.
- **Tenant isolation on the client**: token and location are per-origin; a session stamped for another studio is refused before any request (`workspace-context.tsx:187-189`).
- **Platform import polling** only runs while an import is running and has an in-flight guard.
