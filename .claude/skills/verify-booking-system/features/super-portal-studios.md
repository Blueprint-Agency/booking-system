# Super portal studios

The platform operator signs in to the super portal at `admin.portal.<root>`, sees every studio, creates a new one (its name, address and first admin), and edits a studio's Business details: the formal Business name and other details its Receipts carry, and the Display name its apps and emails use.

## Sub-features

- `super-sign-in` signs the operator in with email, then password.
- `studios-list` lists studios with status badges and a row menu (`Actions for <name>`).
- `studio-create` creates a studio from **New studio**.
- `business-details` edits Business name, Display name, Registration number, Address, Footer note and Receipt number prefix.
- `maintenance` (its own page in the header) is out of this file's scope for now.

## How to get to it (user POV)

- `http://admin.portal.localhost:3001/login`, which lands on the Studios page (`/platform`).
- Studios › **New studio**.
- Studios › a row's **Actions for <name>** menu › **Business details**.

## Driving it with verify-booking-system

Preconditions:

- Doctor passes. The operator `delivered+verify-super@resend.dev` has the password in `state.json` (`state.super.password`), with no 2FA.

- **Sign in.** `signInSuper(page)`. `getByRole('button', { name: 'New studio' })` becomes visible (allow 60 s for the first compile). Checked live 2026-10-24.
- **Create a studio.** Click `New studio`. The dialog `New studio` has textboxes `Domain name`, `Business name (optional)`, `Display name (optional)`, `Address` (the slug), `Time zone` (prefilled `Asia/Singapore`), combobox `Term` (`12 months from today` selected), `First admin’s email (optional)`, `First admin’s name (optional)`, a `Business details (optional)` group, and `Create studio` (disabled until valid). Fill `Domain name` `Verify Yoga`, `Address` a fresh `verify-<random>`, and `First admin’s email (optional)` `delivered+verify-admin@resend.dev`, then click `Create studio`. The Studios list shows `Verify Yoga`. Its hostnames `http://<address>.localhost:3000` and `http://<address>.portal.localhost:3001` answer.
- **Business details.** Open `Actions for Verify Yoga`, choose `Business details`. Fill `Business name` `Verify Yoga Pte. Ltd.`, `Display name` `Verify Yoga`, `Registration number`, `Address`, `Footer note`, `Receipt number prefix`, then `Save`. Reopen the dialog; the values are kept.
- **Proof.** `sql` `select slug, name, status from tenants where slug = '<address>'`, the `tenant_settings` rows for that tenant, `email_log` for the first admin's invitation, and `audit_log`. Screenshots of the list and the reopened dialog.

## Gotchas

- e2e studios are hidden from this list, so create a studio here to act on one. It lives in the throwaway database and goes with `down`.
- The first sign-in on a real deployment mails a set-password link. Here `scripts/super-admin.ts` writes the credential instead (`stack.mjs up`), because the null transport discards the mail. Verifying the first-sign-in email flow itself needs `email_log`, not this shortcut.
- Enrolling 2FA on the operator locks later drives out until the next `up`.
- Create and Business details have not yet been run through this skill; labels come from `fe-portal/src/components/platform/create-tenant-dialog.tsx` (checked live) and `business-details-dialog.tsx` (from source only).
