# Per-tenant mail identity

**Status:** decided, implemented.
**Scope:** every transactional email the platform sends on a studio's behalf.
**Code:** `be/src/lib/mailer.ts`, `be/src/services/tenants/mail-identity.ts`, migration `0036_tenant_mail_identity.sql`.

## The question

A studio's members should recognise its mail. The obvious way to do that is to
send from an address at the studio's own domain — `hello@a-studio.com`. That is
the thing this platform cannot do, and the reason is not a missing feature.

## Why sending as the tenant's domain fails

Two independent checks reject it, and they are checks the *recipient* runs.

**SPF** asks the sending domain which servers may send for it. The platform
sends through Resend on its own verified domain. `a-studio.com`'s SPF record
does not list Resend's servers — it lists whatever the studio's own mail
provider is — so the check fails. The studio would have to publish an SPF record naming
our sender, and only the studio can edit its own DNS.

**DKIM** asks whether the message carries a signature that the sending domain's
published key verifies. The platform can only sign as a domain it holds a key
for. It has no key published in `a-studio.com`, so mail claiming to be from
there arrives unsigned for that domain.

The two together drive **DMARC**, which is what actually decides the outcome:
a message that aligns with neither is quarantined or rejected at the major
mailbox providers. So the failure is not "occasionally lands in spam". It is a
studio's booking confirmations reliably not arriving, and the platform being
unable to fix it without that studio publishing DNS records first.

### What `reservetoday.app` carries

The zone is on Vercel's nameservers (see
`docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`). Outbound mail is
authenticated as `reservetoday.app` through Resend, which needs three records
in the zone, all scoped to the `send` subdomain so the apex stays free for a
human inbox provider:

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey` | the DKIM key Resend issues for the domain |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority 10 |

Plus a `_dmarc` TXT (`v=DMARC1; p=quarantine; rua=mailto:hello@reservetoday.app`)
on the apex — the nameserver move dropped the one that was there. Before Resend,
mail left on a Gmail account and was authenticated as *that* domain; the zone
carried no mail records at all.

## The decision

**v1 sends from the platform's authenticated envelope, wearing the tenant's
display name, with the tenant's address as `Reply-To`.**

```
From:     "A Studio" <noreply@reservetoday.app>
Reply-To: hello@a-studio.com
```

The platform sends from **one** envelope address, for members and staff alike,
never chosen by which studio is speaking:

`noreply@reservetoday.app`, with the name `ReserveToday` where no studio speaks
(super portal mail). Both are constants in `be/src/lib/mailer.ts`
(`PLATFORM_MAIL_FROM_EMAIL`, `PLATFORM_MAIL_FROM_NAME`) — not env, and not
tenant data, because they belong to the platform's domain and are the same for
every studio and every reader.

One address is the conventional setup for transactional mail: the recipient
reads the studio's display name, and a reply goes to the studio's `Reply-To`,
so the envelope address carries nothing worth splitting.

## Sending: one gate, two kinds

Every message leaves through one in-process send gate (`be/src/lib/send-gate.ts`):

- **Two kinds.** *Credential* mail — sign-in code, staff second factor, staff
  password reset, super portal sign-in mail — and *everyday* mail, everything
  else. `mailKind()` in `lib/mailer.ts` decides from the template slug, in one
  place. The kind sets queue priority and a Resend tag; it never changes the
  address.
- **Paced** under Resend's per-team rate limit (`SEND_RATE_PER_SECOND`, 8).
  Credential mail takes the next free slot ahead of waiting everyday mail.
- **Retries** a rate-limit refusal, a 5xx or a network failure, after Resend's
  `retry-after` or exponential backoff with jitter, a bounded number of times.
  A quota refusal (`daily_quota_exceeded`, `monthly_quota_exceeded`) is never
  retried: the send is `failed` in `email_log` and reported as
  `mail_quota_exhausted`. Any other refusal fails at once.
- **Idempotent.** Every send carries a key — the `email_log` row id, or a
  generated one for super portal mail — reused on every retry.
- **Tagged** with `kind`, `template` and `tenant` (no tenant on super portal mail).
- **Watches headroom.** Resend's `x-resend-monthly-quota` header is logged, with
  `mail_quota_monthly_high` past 80% of the month; today's `sent` rows across
  every tenant (`email_log_sent_today()`, migration 0055) raise
  `mail_quota_daily_high` at 80 of Free's 100.

One process only: a second backend instance would double the pace.

- **The display name is what a recipient actually sees.** Every mail client
  shows the name, not the address, in the inbox list. This is the part that
  makes the mail recognisable, and it needs no DNS from anyone.
- **`Reply-To` sends the conversation to the right place.** A member who hits
  reply reaches the studio, not the platform operator.
- **The envelope stays a domain we are authorised for**, so SPF, DKIM and DMARC
  all pass, and delivery is the same for tenant #1 as for tenant #500.
- **Onboarding a studio stays a row insert.** Nothing in this waits on a studio
  editing DNS, which is the whole premise of the product.

Rejected for v1: per-tenant envelope domains. They are the better end state, but
each one requires the studio to publish SPF and DKIM records before its mail
works at all — and a studio whose confirmations silently stop arriving because a
record was mistyped is a worse failure than a shared envelope address.

## Where the identity lives

`tenant_settings.mail_from_name`, `mail_from_email` and `mail_reply_to`, per
tenant. `mail_from_name` falls back to the tenant's own `name`, so a studio is
correctly branded from the moment its row exists and before anyone configures
anything.

`mail_from_email` is a *delegated* address, and today it is **not read at all**.
That is deliberate rather than unfinished: honouring it would put an address on
the envelope that the platform is not authorised to send as, which is the exact
failure this decision exists to avoid — and returning it without honouring it
would be worse still, because a studio would look configured while its mail kept
leaving on the platform's address with nothing to say so. The column becomes
readable at the same moment it becomes honourable: step 2 of the upgrade path
below, where the super portal verifies the domain's records first.

Those columns are **not readable by the application role**. `tenant_settings` is
the one tenant-scoped table with no Row-Level Security policy, because slug
resolution reads it before any tenant context exists, so `be/src/db/roles.ts`
grants SELECT on the display columns by name and nothing else. The mail read
goes through `current_tenant_mail_identity()` (migration 0036): a
`SECURITY DEFINER` function that takes no arguments and answers only for the
tenant whose `withTenant` context is open. The app can therefore read the
identity it is currently sending as, and no other.

## Upgrade path, when a studio wants its own domain

Nothing here has to be undone to get there.

1. Add a subdomain the platform controls per tenant — `{slug}.reservetoday.app`
   — as its own Resend domain. That is DNS we own, so it needs nothing from the
   studio, and it is a strictly better envelope than the shared one.
2. For a studio that wants its *own* domain on the envelope, add it as a Resend
   domain, give the studio the records Resend issues, poll Resend's domain
   status from the super portal, and only then write `mail_from_email`. The
   verification step is the load-bearing part: an unverified domain must never
   reach the envelope.

Both steps change which address `PLATFORM_MAIL_FROM_EMAIL` resolves to for a
given tenant. Neither changes the shape of what the application sends, because
the display name and `Reply-To` are already per-tenant.

## Environment

| Var | Where | Meaning |
|---|---|---|
| `RESEND_API_KEY` | environment secret | Sending-access key for the platform's verified domain. |

The sender address and platform name are code, not env (see above).

Under test (`NODE_ENV=test`) the mailer swaps in a transport that accepts and
discards every message — `.env` holds a live key and the harness cannot tell a
fake one from a real one, so the guard sits on the mode.

Per repo convention these land in `.github/workflows/deploy-be.yml`,
`be/.env.example` and `be/src/env.ts` together.
