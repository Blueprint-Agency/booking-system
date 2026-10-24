# Research: browser-only code in SSR'd client components, and error handling (Next.js 16.3 / React 19.2)

**Pinned versions** (`fe-client/package.json`, confirmed from `node_modules`): `next` 16.3.4, `react` / `react-dom` 19.2.4, `eslint` 9.39.4. The repo has no ESLint config file and no `eslint-config-next` / `eslint-plugin-react-hooks` installed.

**Sources.** Every claim cites a primary source. For Next.js, the docs that ship inside the pinned package (`fe-client/node_modules/next/dist/docs/`, which `fe-client/AGENTS.md` says to read first) are the authority for 16.3.4. Each claim gives the nextjs.org URL of the same page, and the local path where the version matters. The live nextjs.org site may describe a later version.

---

## Rules for this repo

**Hydration: the first client render must equal the server render**

- **DO** treat any hydration mismatch as a bug and fix it. React doesn't patch it up: it throws away the server HTML up to the nearest Suspense or error boundary and renders that part again on the client. [react.dev hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot), [Next preventing-flash](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration)
- **DON'T** read `localStorage`, `sessionStorage`, `document.cookie`, `window.*`, `matchMedia`, `navigator.*`, `Date.now()` / `new Date()`, `Math.random()` or locale/time-zone formatting (`toLocaleString`, `Intl.*` without a fixed `timeZone` and locale) during render of a component that is server-rendered, and don't branch on `typeof window` in render. All of these are named causes. [Next react-hydration-error](https://nextjs.org/docs/messages/react-hydration-error), [React 19 blog](https://react.dev/blog/2024/12/05/react-19)
- **DO** read external or browser state through `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. `getServerSnapshot` must return the same value on the server and on the hydrating client render. Cache snapshots so `getSnapshot` returns the same object while nothing has changed, and define `subscribe` outside the component. This repo already does this: `lib/use-display-prefs.ts`, `lib/use-hydrated.ts`, `lib/auth.ts`. [react.dev useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- **DO** gate "browser-only value decides what's drawn" on `useHydrated()` (`fe-client/src/lib/use-hydrated.ts`, which is `useSyncExternalStore(noop, () => true, () => false)`). Prefer it to `useState(false)` plus `useEffect(() => setX(true))`. That effect pattern renders twice and slows hydration ([hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)). It is also what the React Compiler lint `react-hooks/set-state-in-effect` flags ([lint doc](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect)). `useHydrated` is also `true` straight away for components mounted after hydration, so client navigations don't flash.
- **DON'T** use `useState(() => localStorage.getItem(...))` or `useState(() => Date.now())` in an SSR'd component. The lazy initializer runs on the hydrating client render and produces a value the server never had. The Next docs use this in their accordion example only because an inline script has already made the DOM match ([preventing-flash](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration)). The `purity` lint's "valid" `useState(() => Date.now())` example avoids impurity, but it does not avoid a mismatch ([purity](https://react.dev/reference/eslint-plugin-react-hooks/lints/purity)).
- **DO** use `dynamic(() => import(...), { ssr: false })` only from a `'use client'` file. It is an error in a Server Component. Use it for a widget that can't render on the server at all (canvas, a DOM-only library), not as a cure-all for hydration mismatches. [Next lazy-loading](https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr)
- **DON'T** reach for `suppressHydrationWarning` except for a single unavoidable leaf such as a timestamp, or a value an inline script rewrites before hydration. It covers the attributes and text of **that one element only, one level deep**, and React won't patch the text afterwards. [react.dev common props](https://react.dev/reference/react-dom/components/common), [hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)
- **DO** format dates and times with an explicit `timeZone` (the studio's) and a fixed locale, so the server and browser produce the same string. When the member's own locale is needed, use the Next.js `LocalDate` pattern: an inline script plus `suppressHydrationWarning`. Run the dev server as `TZ=UTC LANG=ja_JP.UTF-8 npm run dev` to expose mismatches. [preventing-flash](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration)
- **DON'T** nest invalid HTML (`<div>` in `<p>`, `<a>` in `<a>`, `<button>` in `<button>`). That causes a hydration error too. [react-hydration-error](https://nextjs.org/docs/messages/react-hydration-error)

**Auth/session**

- **DO** keep the member session "unknown" (`isLoaded: false`) on the server and on the hydrating render. Only after that should the token be read and the view switched to signed-in or signed-out. Render one neutral placeholder or loader for "unknown". Never render the signed-out UI as the default, because it would flash for a signed-in member. `useMemberSession` → `useAppUser` already works this way. See §3.
- **DON'T** try to "fix" the session flash by reading the session on the server. The fe-client token lives in `localStorage` (`rt.client.session`, `lib/member-auth.ts`) and goes to a cross-origin API, so a Server Component cannot see it. Moving to cookies read with `cookies()` would be a different architecture: it makes routes dynamic and needs a same-site cookie. See §3.

**Errors**

- **DO** keep `app/error.tsx` and `app/global-error.tsx` as `'use client'`. `global-error` must render its own `<html>` and `<body>` and import `globals.css` itself. [Next error.js](https://nextjs.org/docs/app/api-reference/file-conventions/error)
- **DO** switch the boundaries from `reset` to **`retry`**, which became stable in 16.3.0. `retry()` fetches the segment again and renders it again. `reset()` only clears the error state and renders again without fetching, and the docs now say "in most cases, you should use `retry()`". Today `fe-client/src/app/error.tsx` and `global-error.tsx` both use `reset`. [error.js § retry / reset](https://nextjs.org/docs/app/api-reference/file-conventions/error)
- **DO** handle errors in event handlers, `fetch` promises, `setTimeout` and effects yourself: `try/catch`, then put the error in state and render it. Error boundaries only catch render errors, plus errors thrown inside `startTransition`. [react.dev Component](https://react.dev/reference/react/Component), [Next error handling](https://nextjs.org/docs/app/getting-started/error-handling)
- **DO** treat an expected failure (4xx, network, validation) as a value to render, not a thrown error. Throw only for bugs. [Next error handling](https://nextjs.org/docs/app/getting-started/error-handling)
- **DON'T** call `notFound()` from a client hook. It can be called in Server Components, Server Functions and Route Handlers, and only on the render path, because it throws. A client-fetched 404 should render its own "not found" state, as the members-only workshop panel does. [notFound](https://nextjs.org/docs/app/api-reference/functions/not-found)
- **DO** use `catchError` from `next/error` for component-level boundaries, rather than a hand-rolled class. It lets `redirect()` / `notFound()` through, supports `retry()`, and clears on navigation. [catchError](https://nextjs.org/docs/app/api-reference/functions/catchError)

**Tooling**

- **DO** replace `"lint": "next lint"`. The command was removed in Next 16, so the script is dead. Add `eslint.config.mjs` with `eslint-config-next/core-web-vitals`, which includes `eslint-plugin-react-hooks` ≥ 7 and its compiler rules `purity`, `set-state-in-effect`, `refs`, `set-state-in-render` and so on. [Next 16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16), [Next ESLint](https://nextjs.org/docs/app/api-reference/config/eslint)
- **DO** add a hydration test: `renderToString` → `hydrateRoot(container, el, { onRecoverableError })`, and fail the test if it is called. Also add a Playwright check for the "Hydration failed" console error. See §5.

---

## 1. Why hydration mismatches happen

- `hydrateRoot()` "expects the rendered content to be identical with the server-rendered content. You should treat mismatches as bugs and fix them." In development React warns. In any build "there are no guarantees that attribute differences will be patched up in case of mismatches", because checking every piece of markup would be too expensive. — https://react.dev/reference/react-dom/client/hydrateRoot
- The most common causes listed by React: `typeof window !== 'undefined'` checks in render, browser-only APIs like `window.matchMedia` in render, different data on server and client, and extra whitespace in the root. — https://react.dev/reference/react-dom/client/hydrateRoot
- Next.js adds these causes: invalid tag nesting (`<p>` in `<p>`, `<div>` in `<p>`, `<ul>` in `<p>`, interactive content inside interactive content), `window` / `localStorage` in render, `Date()` in render, browser extensions, misconfigured CSS-in-JS, and CDN HTML rewriting such as Cloudflare Auto Minify. — https://nextjs.org/docs/messages/react-hydration-error
- iOS turns phone numbers, emails, dates and addresses into links, which causes mismatches. Turn that off with `<meta name="format-detection" content="telephone=no, date=no, email=no, address=no" />`. — https://nextjs.org/docs/messages/react-hydration-error
- React 19 logs a single "Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client" error, with a diff. It lists: `typeof window` branches, `Date.now()` / `Math.random()`, "Date formatting in a user's locale which doesn't match the server", "External changing data without sending a snapshot of it along with the HTML", and invalid nesting. React 19 also skips unexpected tags in `<head>` / `<body>` that extensions insert. — https://react.dev/blog/2024/12/05/react-19
- **What it costs.** Without `suppressHydrationWarning`, "React treats it as a hydration error and recovers by client-rendering from the nearest error or Suspense boundary. This causes a flash." Inline-script corrections elsewhere in that boundary are lost. — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration (local: `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`)
- **Locale and time zone.** `toLocaleDateString()` / `Intl.DateTimeFormat` use the server's settings during SSR and the browser's when hydrating. The mismatch is easy to miss locally. Run with `TZ` / `LANG` set differently from the browser, for example `TZ=UTC LANG=ja_JP.UTF-8 next dev`. — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration

## 2. Reading browser-only state during render

### 2a. `useSyncExternalStore` with `getServerSnapshot`: the default for this repo

- `getServerSnapshot` "will be used only during server rendering and during hydration of server-rendered content on the client. The server snapshot must be the same between the client and the server… If you omit this argument, rendering the component on the server will throw an error." — https://react.dev/reference/react/useSyncExternalStore
- After hydration, React re-renders with `getSnapshot()`. This is how React itself swaps the server value for the browser value without a mismatch. The docs use `navigator.onLine` with `online` / `offline` listeners as the browser-API example. — same URL
- Caveats (same URL):
  - `getSnapshot` must return a cached value while nothing has changed. A new object on every call gives the error "The result of `getSnapshot` should be cached" and an infinite loop. `lib/use-display-prefs.ts` already caches the parsed value for this reason.
  - A `subscribe` that is new on every render resubscribes each time. Define it at module scope or wrap it in `useCallback`.
  - Don't suspend on a store value. External mutations can't be non-blocking Transitions, so they show the nearest Suspense fallback.
- For storage: subscribe to the `storage` event (other tabs), plus your own in-tab emitter, because the `storage` event doesn't fire in the tab that wrote the value. For `matchMedia`, subscribe to the `MediaQueryList` `change` event. In both cases `getServerSnapshot` returns the neutral default.

### 2b. `useEffect`-after-mount gating (`isClient`) and its cost

- The documented recipe is `const [isClient, setIsClient] = useState(false); useEffect(() => setIsClient(true), [])`. It works because the first client render matches the server. — https://nextjs.org/docs/messages/react-hydration-error, https://react.dev/reference/react-dom/client/hydrateRoot
- The cost, according to React: "This approach makes hydration slower because components render twice. Be mindful of user experience on slow connections." — https://react.dev/reference/react-dom/client/hydrateRoot
- The cost, according to Next: "Deferring to `useEffect` avoids the error but introduces a visible flash." — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
- Lint: a synchronous `setState` in an effect is what `react-hooks/set-state-in-effect` flags. The documented exception is a value that "comes from a ref or from an external system". — https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
- Why `useHydrated()` is better for this repo: it gives the same false-on-server, false-while-hydrating guarantee without the effect. It also returns `true` straight away for a component that first mounts after hydration, as on a client navigation, where the effect version would flash one more time. This follows from the `useSyncExternalStore` semantics in 2a: `getServerSnapshot` is used "only during server rendering and during hydration".

### 2c. `next/dynamic` with `ssr: false`

- `dynamic(() => import('../components/C'), { ssr: false })` turns off prerendering for that Client Component. — https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr
- "`ssr: false` option is not supported in Server Components. You will see an error if you try to use it in Server Components… Please move it into a Client Component." — same URL (local: `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`)
- Trade-off: the component isn't in the HTML at all. It loads as a separate chunk after hydration, so reserve space for it to avoid layout shift. Next lists it as "Solution 2" for hydration errors. — https://nextjs.org/docs/messages/react-hydration-error

### 2d. `suppressHydrationWarning`

- "React will not warn you about mismatches in the attributes and the content of that element. It only works one level deep, and is intended to be used as an escape hatch. Don't overuse it." — https://react.dev/reference/react-dom/components/common
- "React will **not** attempt to patch mismatched text content." — https://react.dev/reference/react-dom/client/hydrateRoot, https://nextjs.org/docs/messages/react-hydration-error
- Next's description: "With `suppressHydrationWarning`: React keeps whatever is in the DOM and discards the client's output for that element. The DOM wins." — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
- The scope is the element's own attributes and its direct text, not its subtree. Put it on `<html>` for a theme attribute set by a script in `<head>`, or on a `<time>` leaf. Never put it on a wrapper to hide a mismatch in its children, because it doesn't reach them.

### 2e. Server-safe fallback until hydrated, and the inline-script pattern

- The general rule: render something deterministic (a skeleton, a neutral default, the studio-time-zone string) on the server and on the hydrating render, then switch. This is what `getServerSnapshot` and `useHydrated` produce. — https://react.dev/reference/react/useSyncExternalStore
- To show a browser value **before first paint** with no flash, Next recommends an inline `<script>` that rewrites the DOM while the HTML is being parsed, together with `suppressHydrationWarning` on the element it rewrites. The examples cover dates (`LocalDate` with `useId` and an `InlineScript` whose `type` flips between `text/javascript` and `text/plain`), themes (a `data-theme` attribute on `<html>` set from `localStorage` or a cookie inside `try/catch`), and persisted UI state. — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
  - Caveats: inline scripts need a CSP nonce under a strict CSP. They don't run on client navigations, which is why the Client Component also computes the value when rendering. — same URL
- Reading a cookie with `cookies()` in the root layout "opts the entire app out of static prerendering". Next suggests reading it in the inline script instead. — same URL

## 3. Auth/session in a client hook

**The problem.** A hook that returns `{ signedIn: !!localStorage.getItem(token) }` during render returns `false` on the server and `true` on a signed-in member's first client render. That is the "External changing data without sending a snapshot of it along with the HTML" case. React throws the subtree away and renders it again. — https://react.dev/blog/2024/12/05/react-19

**The pattern that matches.** Use three states: `unknown | signedOut | signedIn`.

1. The server snapshot, and the hydrating render, is `unknown` (`isLoaded: false`). Render one neutral placeholder for it (the page loader or a skeleton), not the signed-out UI. That way neither a signed-in nor a signed-out member sees the wrong UI flash.
2. After hydration, `getSnapshot` / `useHydrated()` reads the token and the hook resolves to `signedOut` or `signedIn`.
3. Keep side effects such as the `/me` read in an effect keyed on the user id, and drop late answers for a user who has changed. `lib/auth.ts` does this with `requestedFor`.

This is `useSyncExternalStore` with `getServerSnapshot` (§2a) applied to the session. `fe-client/src/lib/member-auth.ts` (`useMemberSession`, which uses `useHydrated`) and `lib/auth.ts` (`useAppUser`, whose server snapshot is `() => null` and which returns `isLoaded: false` until the session is read) already follow it.

**Server-side session (the alternative Next documents).**
- Next's auth guide puts the session in an **HttpOnly cookie** ("Prevents client-side JavaScript from accessing the cookie"). It reads the session in a Server Component or Data Access Layer (`verifySession()`), and makes optimistic redirects in Proxy from the cookie alone. — https://nextjs.org/docs/app/guides/authentication
- "Client Components can't import the DAL. Run `verifySession()`… in a parent Server Component, then pass data to client children as props or through a context provider." — same URL
- That lets the server render the right signed-in UI with no "unknown" state. But `cookies()` makes the route dynamic ([preventing-flash § Storing the theme in a cookie](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration)), and it needs the cookie to reach the Next server. fe-client keeps a bearer token in `localStorage` per hostname and calls a cross-origin API (`lib/member-auth.ts`; `docs/adr/0006-per-studio-logins.md`), so the server can't see the token. **For this repo the client-side "unknown until hydrated" pattern is the right one.** Moving to cookies would be an architecture change with its own ADR, not a hydration fix.

## 4. Error handling in the App Router (16.3)

### `error.tsx`
- It must be a Client Component (`'use client' // Error boundaries must be Client Components`). It wraps the segment's `loading`, `not-found`, `page` and nested `layout`, but **not** the `layout.js` / `template.js` of its own segment. — https://nextjs.org/docs/app/api-reference/file-conventions/error (local: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`)
- Props:
  - `error`: in production, `error.message` from a Server Component is generic, and `error.digest` matches the server logs.
  - **`retry`**: "try to re-fetch and re-render the error boundary's children". Added as `unstable_retry` in 16.2.0 and stable in 16.3.0.
  - **`reset`**: "In most cases, you should use `retry()` instead… clear the error state and re-render… without re-fetching." — same URL, Props and Version History
- To pass an error up to the parent boundary, throw from the error component. — same URL
- Errors bubble to the nearest parent `error.tsx`. — https://nextjs.org/docs/app/getting-started/error-handling

### `global-error.tsx`
- Handles errors in the root layout or template. It "must define its own `<html>` and `<body>` tags, global styles, fonts…", because it replaces the root layout. `metadata` isn't supported, so use React's `<title>`. It doesn't pick up an app-level theme class or attribute. Since 15.2 it is also shown in development. — https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error

### `not-found.tsx` and `notFound()`
- `notFound()` throws `NEXT_HTTP_ERROR_FALLBACK;404`, stops rendering the segment and injects `noindex`. It can be called in Server Components, Server Functions and Route Handlers, and only on the render path. A call left in an un-awaited promise renders no not-found UI. — https://nextjs.org/docs/app/api-reference/functions/not-found
- If the check runs inside a `<Suspense>` boundary, the response has already streamed with a `200` (a soft 404). — same URL
- `not-found` is a Server Component by default and can be `async`. The root `app/not-found` also handles unmatched URLs. For client hooks like `usePathname`, "you must fetch data on the client-side instead". — https://nextjs.org/docs/app/api-reference/file-conventions/not-found
- `redirect()` can be called while rendering a Client Component (on SSR it becomes a server redirect), but not in event handlers: use `useRouter` there. — https://nextjs.org/docs/app/api-reference/functions/redirect

### `catchError` (component-level boundary)
- `catchError(Fallback)` from `next/error` makes a boundary you can wrap around any subtree. It supports `retry()`, lets `redirect()` / `notFound()` through, and clears on client navigation. It can be called from Client Components. — https://nextjs.org/docs/app/api-reference/functions/catchError

### What boundaries don't catch
- Error boundaries don't catch errors in: event handlers, server-side rendering, the boundary itself, or asynchronous code such as `setTimeout` and `requestAnimationFrame`. The exception is the `startTransition` callback, whose errors do reach the boundary. — https://react.dev/reference/react/Component
- Next: "errors in event handlers or async code aren't handled by error boundaries because they run after rendering… catch the error manually and store it using `useState` or `useReducer`". "Unhandled errors inside `startTransition` from `useTransition` will bubble up to the nearest error boundary." — https://nextjs.org/docs/app/getting-started/error-handling

### Fetch errors in client hooks
- Next splits errors into **expected** errors (failed requests, validation), which you "handle explicitly and return to the client" and model as return values, and **uncaught exceptions** (bugs), which you throw to a boundary. — https://nextjs.org/docs/app/getting-started/error-handling
- In practice, a client read hook returns `{ data, error, isLoading }`. It catches the rejected `fetch` or a non-OK status in the async callback (a boundary wouldn't see it anyway), stores it in state, and ignores answers that arrive after the key or user has changed. The Next client-data guide describes the same inline `error` state for SWR and TanStack Query. — https://nextjs.org/docs/app/guides/client-side-data-fetching
- To send a caught async error to a boundary on purpose, set it in state and throw it during render, or run the work inside `startTransition`. — https://react.dev/reference/react/Component, https://nextjs.org/docs/app/getting-started/error-handling
- React 19 root error callbacks are `onCaughtError`, `onUncaughtError` and `onRecoverableError`. Hydration mismatches are reported as **recoverable** errors. — https://react.dev/reference/react-dom/client/hydrateRoot, https://react.dev/blog/2024/12/05/react-19

## 5. Lint and tests to prevent regressions

### ESLint
- **`next lint` is removed in Next 16** ("Use Biome or ESLint directly. `next build` no longer runs linting"), and so is the `eslint` option in `next.config`. The codemod is `npx @next/codemod@canary next-lint-to-eslint-cli .`. fe-client's `"lint": "next lint"` is therefore a dead script. — https://nextjs.org/docs/app/guides/upgrading/version-16 (local: `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`)
- `eslint-config-next` bundles `@next/eslint-plugin-next`, `eslint-plugin-react` and `eslint-plugin-react-hooks` in their recommended configurations. Use `eslint-config-next/core-web-vitals` (plus `/typescript`) in a flat `eslint.config.mjs`. — https://nextjs.org/docs/app/api-reference/config/eslint. `eslint-config-next@16.3.4` depends on `eslint-plugin-react-hooks@^7.0.0`; the latest release is 7.1.1 (from `npm view`).
- Relevant rules in the `eslint-plugin-react-hooks` recommended set. Everything except `rules-of-hooks`, `exhaustive-deps` and `component-hook-factories` is a React Compiler rule. — https://react.dev/reference/eslint-plugin-react-hooks

  | Rule | What it checks |
  |---|---|
  | `purity` | Flags `Math.random()`, `Date.now()`, `new Date()`, `crypto.randomUUID()` and `performance.now()` in render. These are exactly the hydration-mismatch sources. https://react.dev/reference/eslint-plugin-react-hooks/lints/purity |
  | `set-state-in-effect` | Flags a synchronous `setState` in an effect: the `isClient` pattern and "set loading true in the effect". https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect |
  | `refs` | Flags reading or writing `ref.current` during render. |
  | `set-state-in-render` | Flags setting state during render. |
  | `globals` | Flags mutating globals during render. |
  | `immutability` | Flags mutating props or state. |
  | `error-boundaries` | Flags `try/catch` around child rendering where an Error Boundary should be used. |

  Flat config: `reactHooks.configs.flat.recommended`. — https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/README.md
- Lint can't see `localStorage` / `window` / `toLocaleString` in render. Guarding those needs a code-review rule (the section above) plus the tests below. `@next/eslint-plugin-next` has no hydration rule; its rule list is in https://nextjs.org/docs/app/api-reference/config/eslint. Marking browser-only modules with `import 'client-only'` gives a build error if they are imported by a Server Component. It doesn't stop SSR of a Client Component. — https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning

### Hydration test (unit/component)
Based on the documented APIs: `hydrateRoot` expects identical output, and mismatches are recoverable errors reported through `onRecoverableError` (https://react.dev/reference/react-dom/client/hydrateRoot).

```ts
// jsdom or happy-dom environment. fe-client's `check` runs node --test on
// .ts only today, so this needs a DOM environment (plus a JSX transform)
// added to that runner.
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react';

test('Component hydrates without a mismatch', async () => {
  // 1) "server": no window, or the storage empty/unseeded
  const html = renderToString(<Component />);
  // 2) "browser": seed the browser-only state that differs from the server
  localStorage.setItem('rt.client.session', 'token');
  const container = document.createElement('div');
  container.innerHTML = html;
  const recoverable: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, <Component />, { onRecoverableError: (e) => recoverable.push(e) });
  });
  assert.deepEqual(recoverable, []); // a hydration mismatch lands here
});
```

Notes:
- For a true server render, run `renderToString` where `window` is undefined: a separate process, or with `globalThis.window` stubbed out. Otherwise `typeof window` branches take the client path on both passes and the test passes when it shouldn't.
- Setting `TZ` / `LANG` differently between the two passes catches locale bugs (https://nextjs.org/docs/app/guides/preventing-flash-before-hydration).

### End-to-end check (Playwright)
- Load a page with a seeded `localStorage` session and a browser locale and time zone that differ from the server's (`TZ=UTC`). Collect `page.on('console')` / `page.on('pageerror')` and fail on any message containing "Hydration failed" or `react.dev/link/hydration-mismatch`. That is the React 19 message text (https://react.dev/blog/2024/12/05/react-19).
- React only prints the full diff in development builds, so run this against `next dev` or a dev build. The fe-client error reporter, `lib/report-error` / Faro, could also forward `onRecoverableError`-class errors in production.

---

## Findings specific to fe-client (from reading the code)

1. `src/app/error.tsx` and `src/app/global-error.tsx` use `reset`. On 16.3.4 the recommended prop is `retry`, which fetches the segment again; `reset` does not.
2. `package.json` `"lint": "next lint"` doesn't work on Next 16, and there's no ESLint config or react-hooks plugin. None of the compiler lints above run.
3. `src/lib/use-hydrated.ts` points to `docs/md/fe-client-hydration.md`, which doesn't exist. This file, or `docs/md/fe-client-navigation.md`, could be what it links to.
4. `typeof window` call sites I checked:
   - `app/(client)/packages/page.tsx:103` is inside a `useEffect`. Safe.
   - `app/(client)/checkout/page.tsx:320` is in render, but only after `isLoaded && !isSignedIn`. `isLoaded` is false on the server and while hydrating, so it's safe for now. It depends on that gate, though; moved above it, it would mismatch.
   - `components/celebration/celebration-sheet.tsx:167,172` (`accountLink`, `calendarUid`) are helpers. They are safe only when called from handlers or effects. Called in render, their server fallbacks (`null`, `reservetoday`) would mismatch.
