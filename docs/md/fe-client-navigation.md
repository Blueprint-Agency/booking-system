# fe-client — how a page change looks, and why

How the member app moves from one page to the next: what the member sees, which
piece of code is responsible for each part, and the rules that keep it from
flickering. Read this before adding a loading state, an entrance animation or a
data hook to `fe-client/`.

## What the member sees

1. They tap a link. The old page fades out quickly (a View Transition, 0.12s).
2. If the new page is already known, because its data was read earlier in this
   visit, it arrives whole on the first frame and rises in (`.page-enter`).
3. Otherwise the space stays empty. If the wait passes 120ms, the app's one
   centred spinner appears. When everything the page reads has landed, the page
   arrives whole, once.

A page never draws its heading and then pops its rows in underneath. A block that
lands above existing content, such as the next-booking ticket or the
cancellation policy, is waited for rather than inserted later. There are no
skeletons and no per-section spinners.

## Who does what

| Piece | Job |
|---|---|
| `components/layout/page-transition.tsx` (used by both `template.tsx` files) | Holds the new page hidden (`.page-pending`) while anything is loading, then reveals it once. An account panel uses the quieter `panel` variant, so a first visit doesn't stack two rises. Reveals anyway after 10s so a stuck read can't hide a page for good. |
| `lib/loading-store.ts` / `ContentLoading` | Counts what is still loading. `useHoldLoader` is a **layout** effect, so a page's holds are registered before `PageTransition` decides whether there is anything to wait for. |
| `components/layout/app-loader.tsx` | The one spinner: shown after 120ms, held up for at least 300ms. |
| `lib/resource-cache.ts` | Stale-while-revalidate for backend reads. The first mount reads; later mounts draw the cached value at once and re-read quietly. It shares one in-flight request between callers and drops responses that arrive late. |
| `components/layout/scroll-to-top.tsx` | A new page opens at its top, before paint. Back / Forward is left alone, so the browser restores the member's place. |
| `next.config.ts` `experimental.staleTimes.dynamic` | Next's client router cache keeps a visited page's server payload for 30s, so going back to a tab needs no server round trip. This is safe because every page is a client component that reads its data in the browser: the payload carries no member data. |

## Rules for new code

- **A backend read in a hook goes through `useCachedResource`.** If what it
  returns depends on who is signed in, the key carries `session.userId`.
- **Some reads are not cached, and on purpose:** saved cards, open purchases, and
  the checkout sync. A stale answer to any of them is actively misleading. Each
  file says so; keep it that way.
- **Loading is `ContentLoading` (or `useHoldLoader`), never a local spinner or
  "Loading…" text.** Anything that renders *above* other content must hold the
  loader until it has landed.
- **A re-read after a change the member made is a quiet `refresh()`.** Never flip
  back to `loading`: that turns the page back into a spinner and out again.
- **No entrance animation inside a page.** `PageTransition` owns page arrival.
  Dialogs and sheets have their own (`animate-fade-up`, `celebrate-pop`).
- **Internal navigation is `<Link>`**, which prefetches, rather than `<a>` or a
  button calling `router.push`, and it points at the final URL, not a redirect
  stub such as `/classes` or `/account/classes`.
- **Overlays use `useBodyScrollLock` and `useFocusTrap`.** Both are safe to nest:
  the lock is counted and pads out the scrollbar's width so the page doesn't
  shift, and only the topmost trap handles Tab.

## Sources

The installed Next 16 docs, under `fe-client/node_modules/next/dist/docs/01-app/`:

- `02-guides/view-transitions.md`: no configuration is needed, and route
  navigations are transitions.
- `02-guides/prefetching.md`: dynamic pages prefetch up to the first `loading.js`
  boundary, and have no client cache by default.
- `03-api-reference/05-config/01-next-config-js/staleTimes.md`: the `dynamic`
  default is 0s; shared layouts are not refetched; back/forward keeps its own
  cache.
