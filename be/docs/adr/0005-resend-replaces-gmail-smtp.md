# Outbound mail leaves through Resend as `reservetoday.app`

**Status**: accepted (2026-09-13).
**Supersedes** the transport half of `docs/md/mail-identity.md` as first written; the per-tenant
identity half stands unchanged.

## Context

Every transactional email — booking confirmations, invitations, cancellation notices — left
through Gmail SMTP on a personal `@gmail.com` account, authenticated as *Gmail's* domain. Members
saw a studio's name over a Gmail address. `reservetoday.app` carried no mail records at all, and
the nameserver move in ADR 0001 dropped the `_dmarc` policy that had been there.

The platform has no mail server and does not want one: bpvps2 runs the backend, and a mail
server on it would be a second attack surface, an IP whose reputation it does not control, and
a port 25 it cannot assume is open.

## Decision

Sending moves to **Resend's HTTP API**, authenticated as `reservetoday.app` through DKIM and SPF
records on the `send` subdomain of the zone. Nodemailer is gone.

Two envelope addresses, chosen by **who is reading**, never by which studio is speaking:

| Recipient | Address | Env |
|---|---|---|
| A member (`recipient.userKind = 'client'`) | `hello@reservetoday.app` | `MAIL_FROM_EMAIL` |
| Staff — admin or instructor (`'staff'`) | `portal@reservetoday.app` | `MAIL_FROM_PORTAL_EMAIL` |

`sendTemplatedEmail` picks the address from the recipient's `userKind`, which every call site
already declares, so no caller chooses — and cannot choose wrongly. Both are env, not
`tenant_settings`: they belong to the platform's domain and are the same for every studio. The
tenant's display name and `Reply-To` are applied exactly as before.

Records are scoped to `send.reservetoday.app` on purpose: the apex MX and SPF stay free for a
human inbox provider, so replying *from* `hello@` by hand is a separate, non-conflicting setup.

## Consequences

- **`RESEND_API_KEY`** replaces `SMTP_USER` / `SMTP_PASSWORD` in the two GitHub Environments,
  `be/.env.example`, `be/src/env.ts` and `.github/workflows/deploy-be.yml`. `MAIL_FROM_EMAIL` is
  now required — there is no credential-derived address to fall back to.
- **`email_log.smtp_message_id`** holds Resend's email id; `smtp_response` is always null. The
  columns keep their names — a rename is a migration for no behavioural gain.
- **Under test** the mailer swaps in a null transport, asserted positively by
  `be/src/test/mailer-transport.test.ts`; the guard is on `NODE_ENV`, not on the key, because the
  harness cannot tell a fake key from a live one.
- **The upgrade path in `mail-identity.md` gets cheaper.** A per-tenant envelope domain is now
  "add a domain on Resend and poll its status", which the super portal can do without touching
  DNS itself.
- **Bounces** are available as Resend webhooks (`email.bounced`, `email.complained`) and are not
  yet consumed. That is the next piece of this, not part of it.
