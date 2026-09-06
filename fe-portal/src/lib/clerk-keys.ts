import { isSuperPortalHost } from "./tenant-host";

/**
 * Which Clerk application a fe-portal request belongs to.
 *
 * One deployment serves two products (`lib/super-portal.ts`), and until now
 * they shared one Clerk application. That sharing is not a configuration
 * detail — it is the reason `admin.portal.…` and `{slug}.portal.…` cannot hold
 * two different signed-in people in one browser.
 *
 * The mechanism is Clerk's session cookie. `__client` is set by the instance's
 * own Frontend API host and scoped to it:
 *
 *   Set-Cookie: __client=…; Domain=clerk.portal.reservetoday.app; HttpOnly
 *
 * Host-only, so it never leaks sideways — the member app's instance answers on
 * `clerk.reservetoday.app` and the two genuinely cannot see each other's
 * sessions. But by the same rule, *one* instance serving two hostnames means
 * one `__client` serving both: sign into the super portal and every studio
 * portal is already signed in as that account.
 *
 * (`__client_uat` *is* set on the registrable domain, `Domain=reservetoday.app`,
 * so every app on the domain shares it. It carries no identity — it is the
 * "is anyone signed in?" hint clerk-js checks before a handshake — and each
 * instance also writes a suffixed copy, `__client_uat_<hash>`, which is the one
 * modern clerk-js reads. It is not what makes two hostnames one person.)
 *
 * So the fix is a second Clerk application for the super portal, and this
 * module is where a request is matched to one. Unset keys fall through to the
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` defaults, which is
 * exactly the behaviour that shipped before this: one shared session, still
 * gated at the API by the backend's `PLATFORM_ADMIN_EMAILS` allowlist.
 *
 * Server-side callers only — `proxy.ts` and the root layout — because
 * `CLERK_PLATFORM_SECRET_KEY` is read here. It is kept out of `super-portal.ts`
 * for exactly that reason: that module is imported by `login/page.tsx`, which
 * is a client component, and a secret has no business in a module reachable
 * from a client bundle.
 *
 * The env references are written out literally rather than looked up by a
 * computed name — Next inlines `process.env.NEXT_PUBLIC_*` at build time and
 * only does so for a literal member expression.
 */
export interface PortalClerkKeys {
  publishableKey?: string;
  secretKey?: string;
}

/** The super portal's own application, or nothing when none is configured. */
function platformKeys(): PortalClerkKeys | null {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PLATFORM_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_PLATFORM_SECRET_KEY;
  // All three or none. The first two are the obvious pair — half a
  // configuration would mint tokens with one instance and verify them with
  // another, which fails as a signature error somewhere far away from the
  // missing variable.
  //
  // `CLERK_ENCRYPTION_KEY` belongs in the same guard because returning
  // `secretKey` here is what makes it mandatory. Clerk encrypts the dynamic
  // keys into the request, and `encryptClerkRequestData` throws outright when
  // a secret is present without it:
  //
  //   if (requestData.secretKey && !ENCRYPTION_KEY) throw new Error(…)
  //
  // That runs inside `decorateRequest` on the `NextResponse.next()` path —
  // which is every `pass()` in `proxy.ts` — so a super portal configured
  // without it does not fall back, it 500s on every request including
  // `/login`. Checking it here degrades that into the documented shared-session
  // fallback instead, which is a bad day rather than an outage.
  if (!publishableKey || !secretKey || !process.env.CLERK_ENCRYPTION_KEY) return null;
  return { publishableKey, secretKey };
}

/**
 * Keys for a request, by hostname. Returns `{}` for a studio portal and for a
 * super portal with no application of its own — in both cases Clerk falls back
 * to the ambient staff-app env vars.
 *
 * Note for `clerkMiddleware`: passing `secretKey` at request time requires
 * `CLERK_ENCRYPTION_KEY` to be set, because Clerk encrypts dynamic keys into
 * the request before server helpers read them back.
 */
export function portalClerkKeys(host: string | null | undefined): PortalClerkKeys {
  if (!isSuperPortalHost(host)) return {};
  return platformKeys() ?? {};
}

/**
 * The publishable half alone, for `<ClerkProvider>`, which needs no secret.
 * `undefined` means "use the ambient env var".
 */
export function portalPublishableKey(host: string | null | undefined): string | undefined {
  return portalClerkKeys(host).publishableKey;
}
