# Research — perceived load performance in fe-portal and fe-client

> Research note, not a spec. It covers what the primary sources say about loading UX, and
> ends with a short recommendation for each app. Nothing here has been implemented.
> Next.js docs quoted are the v16.3 pages (the version both apps run, `next@16.3.4`).

## Where each app stands today

**fe-portal: a serial waterfall behind a blank gate.** On a cold load of `/admin/*` the
staff member sees nothing useful until four things have happened one after another:

1. The HTML arrives. `app/admin/layout.tsx` is a server component, but all it renders is
   `WorkspaceProvider` → `AdminShell`, and on the server `AdminShell` is already in its
   `loading` branch. So the first paint is the full-screen "Loading workspace…" line.
2. The JS downloads and hydrates. Nothing below can start before this.
3. `usePortalSession()` (`lib/portal-auth.ts`) makes Better Auth's `get-session` round trip
   to the API. `isLoaded` stays false until it answers.
4. Only then does `WorkspaceProvider` (`lib/workspace-context.tsx`) call `GET /portal/auth/me`.
   `loading` flips to false, the nav, top bar and page mount, and the page makes its own
   fetches: a fifth serial step.

`instructor-shell.tsx` works the same way. `fe-portal` has no `loading.tsx` anywhere, so
Next has no fallback to prefetch or show during client navigations between dynamic routes
(`app/admin/layout.tsx` reads `headers()`, which makes the whole tree dynamic).

**fe-client: a working pattern.** `app/(client)/layout.tsx` server-renders `AppShell`
(the chrome). `AppLoader` draws one centred `PageLoader` card when either:

- a same-origin link click is waiting on a pathname change, or
- a `ContentLoading` placeholder is registered through `lib/loading-store.ts`.

It waits 120 ms before showing and fades in over 0.2 s. `(client)/loading.tsx` returns
`ContentLoading`, so route fallbacks also feed the one spinner. It has a delay before
showing, but **no minimum time on screen**: a wait of 130 ms shows the card for about
10 ms, part-way through its fade.

---

## 1. Cold first load: a server-painted shell rather than a client gate

- **The thresholds.** web.dev puts a *good* First Contentful Paint at **≤ 1.8 s** and a good
  Largest Contentful Paint at **≤ 2.5 s**, both at p75
  ([FCP](https://web.dev/articles/fcp), [LCP](https://web.dev/articles/lcp)). An element
  only counts toward LCP once it is "rendered and visible to the user". Content that waits
  for hydration and two API round trips has its LCP at the end of that chain.
- **Why client rendering costs this.** "The amount of JavaScript required tends to grow as an
  application grows, which can impact a page's INP"; and "streaming server-side rendering
  lets you send HTML in chunks that the browser can progressively render as it's received
  … speeding up your FCP"
  ([web.dev, Rendering on the Web](https://web.dev/articles/rendering-on-the-web)).
- **What Next does here.** "HTML is also generated for the initial visit"
  ([Linking and Navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating)).
  Whatever the server renders therefore paints before hydration, styled by the CSS that
  `globals.css` already puts in the `<head>`. That includes a client component's
  *server-side* output.

**The implication for a bearer-token app.** The server cannot know who the user is,
because the token lives in `localStorage`. It can still render everything that does not
depend on who the user is: the frame of the nav rail, the top bar with the studio's brand
(already resolved server-side through `getBrand()`), and a skeleton for the content area.
This is the app shell pattern. What fe-portal gets wrong is not that its gate is
client-side. It is that the gate replaces the whole screen, so the server's HTML carries
no shell. A splash that depends on client JS cannot paint before hydration. A static
shell in the server HTML can.

Apple's HIG makes the same point about native launch screens: show a screen that looks
like the app's first screen, not a "loading" splash
([HIG, Launching](https://developer.apple.com/design/human-interface-guidelines/launching);
its [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
page adds: prefer determinate indicators, and keep them moving).

## 2. Avoiding the blank auth gate

- **Gate the content area, not the chrome.** Put the gate inside `<main>`, not around the
  shell. The nav and top bar render immediately: role-specific items and the user menu
  appear once `/auth/me` answers, and fixed-size placeholders hold their space until then.
  This follows the guidance on
  [`loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading) that
  "shared layouts remain interactive while new route segments load". It also follows the
  React guidance to avoid "hiding already revealed content"
  ([react.dev, Suspense](https://react.dev/reference/react/Suspense)).
- **Render optimistically from a cached `/auth/me`.** Store the last `AuthMePayload` (name,
  role, locations) in `localStorage` next to the token, under the same per-hostname key
  scheme as `rt.<pool>.session`, so studio isolation holds. On load, if a token *and* a
  cached `me` exist, render the shell and the page straight away from the cache, and let
  the fetches revalidate it in the background. This is stale-while-revalidate applied to
  identity. Its safety rests on the backend being the real boundary: every API call is
  still authorised server-side, as the comment in `admin-shell.tsx` already says. The
  cache only decides what to *draw*. The requirements:
  - Clear the cache wherever the token is cleared (`signOutPortal`, the `sign-out` and
    `denied` branches of `loadMe`).
  - On a mismatch (a different role or user, a 401 or a 403), replace the view with what
    the backend said, and do not show cached data for more than one render.
  - Never use the cache to skip `sessionTenantRefusal`. That check is local and costs
    nothing, so it can keep running first.
- **Break up the waterfall.** `get-session` and `/auth/me` are serial only because
  `api` is built from `isSignedIn`. With a token present, `/auth/me` can be sent in
  parallel with `get-session`, and the page's own first fetch can often run alongside
  `/auth/me` too. The backend's 401 is the arbiter either way.

## 3. Route transitions

- **`loading.tsx` per segment.** Next's own advice for dynamic routes is to "add
  `loading.tsx` to dynamic routes to enable partial prefetching, trigger immediate
  navigation, and display a loading UI while the route renders". For a dynamic route, the
  default `prefetch` fetches "the partial route down to the nearest segment with a
  `loading.js` boundary"
  ([Link](https://nextjs.org/docs/app/api-reference/components/link)). **Without one,
  nothing is prefetched for a dynamic route, and the click waits on the server.** The
  fallback "is prefetched, making navigation immediate unless prefetching hasn't
  completed". One caveat applies: `loading.js` does not wrap its own segment's
  `layout.js`, and "if the layout accesses uncached or runtime data (e.g. … `headers()`)
  … navigation blocks until the layout finishes rendering". That is why the boundary
  belongs *below* `app/admin/layout.tsx`, at `app/admin/loading.tsx`, which wraps the
  pages under it, or deeper.
- **Choosing the indicator.**
  - **Nielsen Norman Group.** Show nothing under 1 s, because it "creates distracting
    visual flashes". Use a looped spinner for 2–10 s, and a percent-done indicator beyond
    10 s ([Progress indicators](https://www.nngroup.com/articles/progress-indicators/)).
    Skeletons suit "when the full screen is loading" for waits under 10 s, and spinners
    are "best used on a single module"
    ([Skeleton screens](https://www.nngroup.com/articles/skeleton-screens/)). NNG also
    warns against frame-only skeletons that show only headers and backgrounds.
  - **Material 3.** "Linear indicators are best when placed on the edge of a container";
    "use a single progress indicator at the top of a page to show progress of the whole
    group"; circular indicators are "centered directly on the container or page that's
    loading" ([M3 guidelines](https://m3.material.io/components/progress-indicators/guidelines)).
  - **A top progress bar** is Next's suggested alternative for slow transitions (it links
    [vercel/react-transition-progress](https://github.com/vercel/react-transition-progress)).
    It suits a dense staff dashboard, because it never covers the table the user is
    reading.
- **`useLinkStatus`** (added in v15.3) returns `{ pending }` for the enclosing `<Link>`,
  and is meant for "subtle, inline feedback". "If the linked route has been prefetched,
  the pending state will be skipped". The docs call it "a quick patch": prefer
  `loading.js` and prefetching
  ([useLinkStatus](https://nextjs.org/docs/app/api-reference/functions/use-link-status)).
  In a nav rail, it works well as a small pending dot next to the clicked item.
- **Transitions keep the old screen up.** React recommends that navigations be
  transitions because "transitions prevent unwanted loading indicators, which lets the
  user avoid jarring jumps on navigation"
  ([useTransition](https://react.dev/reference/react/useTransition)). For client-side
  refetches (filters, week steppers), keep the stale data on screen, dimmed, rather than
  swapping in a spinner. The pattern is `useDeferredValue` or `isPending` plus an opacity
  change ([Suspense](https://react.dev/reference/react/Suspense)).

## 4. Anti-flicker: a delay before showing, and a minimum time on screen

| Source | Show after | Minimum on screen |
|---|---|---|
| Nielsen Norman Group response-time limits ([link](https://www.nngroup.com/articles/response-times-3-important-limits/)) | 0.1 s feels instant, no feedback needed; up to 1 s is noticed but flow is kept; 10 s is where attention is lost | — |
| Next.js `useLinkStatus` docs | "initial animation delay (e.g. 100ms)", starting from `opacity: 0` | — |
| React Suspense | — | "reveals suspended content at most once every 300ms" (batching) |
| `spin-delay` (a widely used hook, [repo](https://github.com/smeijer/spin-delay)) | 500 ms default | 200 ms default. Without a minimum, a 210 ms request "we see a spinner for 10ms" |

In practice, show the indicator after about 100–150 ms. Once it is up, keep it up for at
least about 300 ms, so it never blinks. Skeletons that belong to the server-rendered
shell are the exception: they are the first paint, so they need no delay.

web.dev's INP guidance points the other way for the *click itself*. The next frame should
already show that the click registered ("≤ 200 ms" is good INP;
[INP](https://web.dev/articles/inp)). An immediate active state on the clicked nav item,
with the delayed indicator after it, meets both.

## 5. Prefetching for client-heavy pages

- Prefetching runs "only in production", when a `<Link>` enters the viewport, and runs
  again on hover if the data has expired. `<Link>` "must be hydrated before it can
  prefetch": a large bundle delays prefetching on the first visit.
- Next's prefetch covers the **RSC payload and JS for the route**. It does not cover data
  that pages fetch client-side with the bearer token. For fe-portal, nearly all data is
  fetched that way, so prefetching makes the *code* and the `loading.tsx` fallback
  instant, but not the data. To warm data on hover, the page's fetcher has to be kicked
  off from `onMouseEnter` or `onNavigate` and the result kept in a small cache that the
  page reads first. This is only worth doing for the two or three heaviest pages
  (schedule, members).
- Keep the default `prefetch` on nav links. Use `prefetch={false}` (or prefetch on hover
  only) for long lists of row links, such as member tables, as the docs suggest.

---

## Recommendation

### fe-portal (staff dashboard): the higher priority

1. **Render the shell, gate `<main>`.** Change `AdminShell` and `InstructorShell` to always
   render the nav and top bar, which are server-rendered on the first paint. While
   `loading`, the nav shows a fixed-height placeholder list and the top bar shows the
   brand but no user menu. Move the "Loading workspace…" gate into the content area as a
   skeleton, or as a `ContentLoading`-style hold that feeds a single indicator. The
   instructor/admin role bounce stays as it is.
2. **Cache `/auth/me` per hostname, and render from it at once** when a token is present.
   Revalidate in the background, and clear the cache wherever the token is cleared. This
   takes steps 3 and 4 of the waterfall off the critical path for returning staff: nearly
   every load.
3. **Send `/auth/me` without waiting for `get-session`** when a token exists.
4. **Add `app/admin/loading.tsx` and `app/instructor/loading.tsx`** (below the
   `headers()`-reading layouts). This enables partial prefetch and instant fallbacks.
5. **Port fe-client's `AppLoader` + `loading-store` + `PageLoader`**, copied rather than
   shared (apps stay decoupled), with two changes:
   - For a dashboard, draw it as a **thin top progress bar**, per Material's
     "single indicator at the top of a page". A centred card suits the member app but
     hides dense tables.
   - Add a **minimum on-screen time of about 300 ms**.

   For the nav rail, add a `useLinkStatus` pending dot.

### fe-client (member app): keep the pattern and tune it

1. **Keep `AppLoader`/`PageLoader`/`loading-store` as the one indicator.** It already
   follows the "one indicator for the whole page" guidance and the 100 ms-class delay.
2. **Add a minimum on-screen time** (about 300 ms from when the card first becomes
   visible) to both the nav and content paths. This stops the spinner blinking for 10 ms
   on waits just over 120 ms.
3. **Keep stale content visible on in-page refetches** (the week stepper, filters) using
   `useDeferredValue` or `isPending` and dimming, rather than registering a hold, so the
   list does not blank out.
4. **Consider a skeleton for the first cold load only** of the two or three primary
   screens (booking list, account). NNG favours skeletons for full-screen loads, and the
   server can paint one before hydration. The spinner stays for navigations. This is
   optional: the chrome is already server-rendered, so the current gap is small.
