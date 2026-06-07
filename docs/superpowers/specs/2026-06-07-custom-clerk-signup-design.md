# Custom Clerk Signup Form — Design

**Date:** 2026-06-07
**App:** `fe-client` (member-facing) + small `be` webhook change
**Status:** Approved

## Goal

Replace the prebuilt Clerk `<SignUp>` component on `/register` with a custom
`useSignUp()` flow that adds capabilities the prebuilt component can't provide:

1. **Confirm-password field** with client-side match validation (prebuilt Clerk
   has no confirm-password option).
2. **Required phone number** with a country-code picker, collected **without SMS
   verification** (default country: Singapore).
3. **Free email-OTP verification** (six-digit `email_code`) to complete signup.
4. Preserve the existing `AuthSplitShell` styling/layout.

No paid Clerk features are introduced: email codes are free on all plans; the
phone is stored as plain data (NOT a Clerk phone identifier), so no SMS / phone
OTP / Pro plan is required.

## Non-Goals

- The sign-in / `/login` page stays on the prebuilt Clerk component — unchanged.
- No SMS verification, no phone OTP, no Clerk Pro plan.
- No social sign-up (already hidden today; remains out).

## Architecture

### FE — `fe-client/src/app/(client)/register/[[...rest]]/page.tsx`

Rewritten as a custom client component driven by `useSignUp()`. Two view states:

- **`form`** — collects: first name, last name, email, phone, password, confirm
  password.
- **`verify`** — collects the six-digit email code.

Phone input uses **`react-phone-number-input`** (E.164 output, `defaultCountry="SG"`),
with its stylesheet imported and restyled to match `AuthSplitShell` (rounded
inputs, accent focus ring). All markup stays inside the existing `AuthSplitShell`.

A `<div id="clerk-captcha" />` element is rendered — Clerk Smart CAPTCHA bot
protection requires it for custom (non-prebuilt) sign-up flows.

### Flow

1. **Form view** collects the fields above.
2. **Client-side validation:** required fields present; email format; phone valid
   via `isValidPhoneNumber(phone)`; `password === confirmPassword`; password min
   length.
3. `signUp.create({ emailAddress, password, firstName, lastName, unsafeMetadata: { phone } })`
4. `signUp.prepareEmailAddressVerification({ strategy: 'email_code' })` → switch
   to **verify view**.
5. **Verify view:** user enters the code → `signUp.attemptEmailAddressVerification({ code })`.
6. On `status === 'complete'`: `setActive({ session: createdSessionId })` →
   redirect to `next` (from `?next=`, default `/`).
7. A **"Resend code"** action re-calls `prepareEmailAddressVerification`.

### Phone persistence (Approach A — chosen)

Clerk does not store a non-identifier phone, so the collected phone rides in
Clerk **`unsafeMetadata.phone`** (set at `signUp.create`). This is atomic with
account creation and avoids any race against the asynchronous webhook.

**BE — `be/src/services/auth/webhook-sync.ts`:**

- Extend the `ClerkWebhookUser` type with `unsafe_metadata?: { phone?: string }`.
- Add an `unsafePhone(user)` helper returning `user.unsafe_metadata?.phone`.
- **Insert path only** (`syncClientFromClerk` self-registration insert):
  `phone: primaryPhone(clerkUser) ?? unsafePhone(clerkUser) ?? ''`.
- **Update/sync path unchanged.** `primaryPhone()` stays Clerk-identifier-only
  (returns `null` here), so a later `user.updated` (e.g. a name change) never
  clobbers an edited phone with stale metadata. `PATCH /me` from the account
  profile page remains the sole owner of subsequent phone edits.

Rejected alternative (B): post-verification `PATCH /me`. The `clients` row is
created asynchronously by the webhook, so `PATCH /me` can race ahead of the row
existing — fragile. Not used.

## Error Handling

Map Clerk `err.errors[]` to inline, user-readable messages:

- Email already exists (`form_identifier_exists`) → message + link to `/login`.
- Weak/pwned password (`form_password_pwned`, length rules) → field-level error.
- Invalid / expired verification code → error on the code field.
- Network / unexpected → generic fallback message.

Submit buttons show loading + disabled states while requests are in flight.

## Dashboard Prerequisite (manual, human-only)

In the **Clerk client app** dashboard, phone must **NOT** be enabled as an
identifier under User & Authentication → Phone (enabling it would force SMS OTP).
Email + password remain enabled. First/last name can stay optional in the
dashboard since we always submit them via the API. This step is outside the
codebase and must be set by a human in the Clerk dashboard.

## Verification

- `npx tsc --noEmit` in `fe-client` and in `be` (no Vitest in `be`).
- `next build` in `fe-client` (`npm run lint` is known-broken — do not gate on it).
- Manual dogfood: register → receive email code → verify → land logged-in →
  open account → profile and confirm the phone is populated.

## Affected Files

- `fe-client/src/app/(client)/register/[[...rest]]/page.tsx` — rewritten.
- `fe-client/package.json` — add `react-phone-number-input`.
- `be/src/services/auth/webhook-sync.ts` — `unsafe_metadata` type + `unsafePhone()`
  helper + insert-path fallback.
