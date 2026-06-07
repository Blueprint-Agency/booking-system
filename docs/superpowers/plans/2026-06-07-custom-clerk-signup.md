# Custom Clerk Signup Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prebuilt Clerk `<SignUp>` on `/register` with a custom `useSignUp()` flow that adds a confirm-password field, a required country-code phone number (collected without SMS), and free email-OTP verification.

**Architecture:** A custom client component drives the two-step Clerk sign-up (`create` → email-code `verify`). The phone is captured client-side via `react-phone-number-input` (E.164) and stored in Clerk `unsafeMetadata.phone`; the BE `user.created` webhook reads that metadata to populate the `NOT NULL` `clients.phone` column on the insert path only.

**Tech Stack:** Next.js App Router (client component), `@clerk/nextjs` ^7.3.3 (`useSignUp`), `react-phone-number-input`, Hono + Drizzle (BE webhook), Tailwind.

> **Testing note (codebase reality):** `be/` has no Vitest and `fe-client`'s `npm run lint` is broken. There is no unit-test runner for either app. This plan gates each task on `npx tsc --noEmit` (both apps) and `next build` (fe-client), then a final manual dogfood — matching how this repo is actually verified. Do **not** invent test infra or helpers.

---

## File Structure

- `fe-client/package.json` — add `react-phone-number-input` dependency.
- `fe-client/src/app/(client)/register/[[...rest]]/page.tsx` — rewritten: custom two-view sign-up (`form` → `verify`). Single responsibility: the registration UI + Clerk flow.
- `fe-client/src/app/globals.css` — append phone-input style overrides so `react-phone-number-input` matches `AuthSplitShell`.
- `be/src/services/auth/webhook-sync.ts` — add `unsafe_metadata` to `ClerkWebhookUser`, add `unsafePhone()` helper, use it on the client insert path only.

---

### Task 1: Add the phone-input dependency

**Files:**
- Modify: `fe-client/package.json`

- [ ] **Step 1: Install the package**

Run (from repo root):
```bash
cd fe-client && npm install react-phone-number-input
```
Expected: `package.json` + `package-lock.json` updated; `node_modules/react-phone-number-input` present. The package ships its own TypeScript types — no `@types/*` needed.

- [ ] **Step 2: Verify it resolves**

Run (from `fe-client/`):
```bash
node -e "require.resolve('react-phone-number-input'); require.resolve('react-phone-number-input/style.css'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add fe-client/package.json fe-client/package-lock.json
git commit -m "build(fe-client): add react-phone-number-input"
```

---

### Task 2: BE webhook — persist collected phone from unsafe_metadata

The `clients.phone` column is `NOT NULL`. Today the client insert falls back to `''`. Read the phone the custom form stashed in Clerk `unsafeMetadata.phone` so the row is created with the real number. **Insert path only** — the update/sync path stays Clerk-identifier-only so a later `user.updated` (e.g. a name change) never clobbers a phone the member edited via `PATCH /me`.

**Files:**
- Modify: `be/src/services/auth/webhook-sync.ts`

- [ ] **Step 1: Add `unsafe_metadata` to the `ClerkWebhookUser` type**

Find the `ClerkWebhookUser` interface (the block with `primary_email_address_id`, `phone_numbers`, `first_name`, etc., around lines 18–25) and add this field to it:

```ts
  unsafe_metadata?: { phone?: string } | null
```

- [ ] **Step 2: Add the `unsafePhone` helper**

Directly below the existing `primaryPhone` function (around lines 28–35), add:

```ts
// The custom client sign-up form stashes the collected (non-SMS) phone here,
// since Clerk only stores phone numbers that are verified identifiers.
function unsafePhone(user: ClerkWebhookUser): string | null {
  const p = user.unsafe_metadata?.phone
  return p && p.trim() ? p.trim() : null
}
```

- [ ] **Step 3: Use it on the client insert path**

In `syncClientFromClerk`, find the self-registration insert (`db.insert(clients).values({ ... })`, around lines 185–192). Change the `phone` line from:

```ts
      phone: primaryPhone(clerkUser) ?? '',
```
to:
```ts
      phone: primaryPhone(clerkUser) ?? unsafePhone(clerkUser) ?? '',
```

Leave the already-linked update branch (the `set.phone` logic earlier in the function) unchanged.

- [ ] **Step 4: Type-check the backend**

Run (from `be/`):
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add be/src/services/auth/webhook-sync.ts
git commit -m "feat(be): populate clients.phone from Clerk unsafe_metadata on signup"
```

---

### Task 3: Rewrite the register page as a custom Clerk flow

**Files:**
- Modify (full rewrite): `fe-client/src/app/(client)/register/[[...rest]]/page.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
"use client";

import { Suspense, useState } from "react";
import { useSignUp } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import Link from "next/link";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";
const primaryBtnClass =
  "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2 disabled:opacity-50";

// Map a Clerk error to a readable message.
function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: Array<{ code?: string; message?: string }> };
  const first = e?.errors?.[0];
  if (first?.code === "form_identifier_exists") {
    return "An account with this email already exists. Try signing in instead.";
  }
  return first?.message ?? "Something went wrong. Please try again.";
}

function RegisterContent() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [view, setView] = useState<"form" | "verify">("form");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!isLoaded) return;

    setSubmitting(true);
    try {
      await signUp.create({
        emailAddress: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        unsafeMetadata: { phone },
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setView("verify");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLoaded) return;

    setSubmitting(true);
    try {
      const res = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        router.push(next);
      } else {
        setError("Verification could not be completed. Please try again.");
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    if (!isLoaded) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  }

  if (view === "verify") {
    return (
      <AuthSplitShell
        imageKey="hero-pilates-01"
        quote="Every student begins with a single breath."
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Check your email
        </h1>
        <p className="text-sm text-muted mb-8">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="code" className={labelClass}>
              Verification code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={inputClass}
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Verifying…" : "Verify & create account"}
          </button>
        </form>
        <button
          type="button"
          onClick={handleResend}
          className="mt-4 text-sm text-accent-deep font-medium"
        >
          Resend code
        </button>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell
      imageKey="hero-pilates-01"
      quote="Every student begins with a single breath."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-8">
        Create your account
      </h1>
      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>First name</label>
            <input id="firstName" className={inputClass} value={firstName}
              onChange={(ev) => setFirstName(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>Last name</label>
            <input id="lastName" className={inputClass} value={lastName}
              onChange={(ev) => setLastName(ev.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" className={inputClass}
            value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone</label>
          <PhoneInput
            id="phone"
            international
            defaultCountry="SG"
            value={phone}
            onChange={setPhone}
            className="ys-phone-input"
          />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <input id="password" type="password" autoComplete="new-password" className={inputClass}
            value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm password</label>
          <input id="confirm" type="password" autoComplete="new-password" className={inputClass}
            value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {/* Clerk Smart CAPTCHA mounts here (required for custom sign-up flows). */}
        <div id="clerk-captcha" />

        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-deep font-medium">Sign in</Link>
      </p>
    </AuthSplitShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Type-check fe-client**

Run (from `fe-client/`):
```bash
npx tsc --noEmit
```
Expected: no errors. (If `setActive`/`createdSessionId` types complain, confirm `@clerk/nextjs` is ^7.x — the `useSignUp` return shape used here matches 7.3.3.)

- [ ] **Step 3: Commit**

```bash
git add "fe-client/src/app/(client)/register/[[...rest]]/page.tsx"
git commit -m "feat(fe-client): custom Clerk signup (confirm password + phone + email OTP)"
```

---

### Task 4: Style the phone input to match AuthSplitShell

`react-phone-number-input` ships unstyled-ish defaults. Override them so the field matches the other rounded inputs (`inputClass`).

**Files:**
- Modify: `fe-client/src/app/globals.css`

- [ ] **Step 1: Append the overrides**

Add to the end of `fe-client/src/app/globals.css`:

```css
/* react-phone-number-input — match AuthSplitShell field styling */
.ys-phone-input {
  display: flex;
  gap: 0.5rem;
}
.ys-phone-input .PhoneInputInput {
  border-radius: 0.75rem;
  border: 1px solid rgb(0 0 0 / 0.1);
  background: var(--paper, #fff);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  width: 100%;
}
.ys-phone-input .PhoneInputInput:focus {
  outline: none;
  border-color: var(--accent, #b45309);
}
.ys-phone-input .PhoneInputCountry {
  border-radius: 0.75rem;
  border: 1px solid rgb(0 0 0 / 0.1);
  padding: 0 0.75rem;
}
```

> If `--paper` / `--accent` are not defined as CSS variables in this project, replace them with the literal colors used by the Tailwind `bg-paper` / `border-accent` utilities (check `globals.css` / `tailwind.config`); the focus/border just needs to visually match the other inputs.

- [ ] **Step 2: Type-check + build fe-client**

Run (from `fe-client/`):
```bash
npx tsc --noEmit && npm run build
```
Expected: type-check clean; `next build` completes successfully (do NOT run `npm run lint` — it is known-broken in this repo).

- [ ] **Step 3: Commit**

```bash
git add fe-client/src/app/globals.css
git commit -m "style(fe-client): match phone input to auth form styling"
```

---

### Task 5: Manual verification (dogfood)

No automated end-to-end runner exists; verify the flow by hand.

**Prerequisite (human, in Clerk dashboard):** In the **client** Clerk app, confirm Phone is **NOT** enabled as an identifier (User & Authentication → Phone) — otherwise Clerk forces SMS OTP. Email + password stay enabled.

- [ ] **Step 1: Run the app**

Run (from `fe-client/`):
```bash
npm run dev
```
Open `http://localhost:3000/register`.

- [ ] **Step 2: Walk the happy path**

- Fill first/last name, email (use a Clerk test address or a real inbox), a valid SG phone, matching passwords (≥8 chars).
- Submit → expect the verify view ("Check your email").
- Enter the emailed 6-digit code → expect redirect to `/` (logged in).

- [ ] **Step 3: Check the negative paths**

- Mismatched passwords → inline "Passwords do not match." (no network call).
- Invalid/empty phone → inline "Please enter a valid phone number."
- Re-register with an existing email → "An account with this email already exists…".

- [ ] **Step 4: Confirm phone persisted to the BE**

- After signup completes, go to account → profile and confirm the **Phone** field shows the number entered at signup (proves the `unsafe_metadata` → webhook → `clients.phone` path worked).
- If running the BE locally without a public webhook URL, instead verify by querying the `clients` row for the new email and checking `phone`.

---

## Notes for the Implementer

- The login/`/login` page is intentionally untouched (still prebuilt `<SignIn>`).
- `unsafeMetadata` is the correct bucket: it is settable from the frontend by design and is the only place to stash the non-identifier phone at `create` time.
- The BE change is deliberately scoped to the **insert** path so it can't overwrite member-edited phones on later `user.updated` events.
