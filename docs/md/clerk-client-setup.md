# Clerk — client app setup (member-facing)

The BE sends **no** auth emails. Clerk (the `CLERK_CLIENT_*` app) hosts all of them — sign-up
verification and password-reset codes. "When emails get sent" is therefore a Clerk
**dashboard** configuration, not BE code. Configure the **client** Clerk application (the one
whose keys live in the `fe-client` Vercel project — never the staff app):

## Email & verification
- **User & Authentication → Email, Phone, Username:** Email address required; enable
  **Verify at sign-up** with **Email verification code**. This matches the BE `requireVerified`
  gate (`be/src/middleware/clerk-client.ts`), which blocks booking/PT writes until email +
  phone are verified.
- **Phone:** required + verified, so `requireVerified` can pass for booking writes (a later
  pass — booking writes are not yet implemented).

## Password reset
- **User & Authentication → Password:** enable **"Allow users to reset their password"** via
  **email verification code**. This is the flow surfaced by the `<SignIn>` widget's
  "Forgot password?" link — there are no custom reset pages (the old `/forgot-password` and
  `/reset-password` pages were dead UI and have been removed).

## Paths & redirects
- **Paths:** Sign-in URL `/login`, Sign-up URL `/register` — these must match the
  `ClerkProvider` props in `fe-client/src/app/layout.tsx` (`signInUrl="/login"`,
  `signUpUrl="/register"`).
- **Allowed origins / redirect URLs:** include the fe-client origin (local
  `http://localhost:3000` and the Vercel production URL).
- Post-auth return: protected routes redirect signed-out users to `/login?next=<path>`
  (enforced by `fe-client/src/proxy.ts` — Next 16's renamed middleware file; protects
  `/account/*` and `/checkout`). The `<SignIn>` component reads `?next=` to return the user
  to where they were.

## Email templates
- Review the **Verification code** and **Reset password code** templates under
  **Customization → Emails** for Yoga Sadhana branding.

## Keys (already provisioned per CLAUDE.md)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` set in the fe-client Vercel project.
- The BE verifies client JWTs with `CLERK_CLIENT_SECRET_KEY` (+ optional
  `CLERK_CLIENT_AUTHORIZED_PARTIES`); never share keys with the staff app. Cross-app tokens are
  rejected by the BE middleware on purpose.
