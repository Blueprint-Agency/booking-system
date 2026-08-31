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
sends through Gmail SMTP on its own credentials. `a-studio.com`'s SPF record
does not list those servers — it lists whatever the studio's own mail provider
is — so the check fails. The studio would have to publish an SPF record naming
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

### What `reservetoday.app` carries today

The zone is on Vercel's nameservers and carries the records the apps and the CDN
need — the wildcard hosts and `cdn.reservetoday.app` (see
`docs/adr/0001-reservetoday-app-on-vercel-nameservers.md` and
`docs/md/deployment.md`). It carries **no mail records**: no MX, no SPF, no DKIM
selector, no DMARC policy. Mail leaves on the Gmail account behind `SMTP_USER`
and is authenticated as that account's domain, not as `reservetoday.app` and not
as any tenant's domain.

## The decision

**v1 sends from the platform's authenticated envelope, wearing the tenant's
display name, with the tenant's address as `Reply-To`.**

```
From:     "A Studio" <the platform's SMTP address>
Reply-To: hello@a-studio.com
```

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
anything. `mail_from_email` is a *delegated* address — it is only honoured once
the platform is genuinely authorised to send as it, which is the upgrade path
below; a tenant that has not been through that leaves it null and sends on the
platform address.

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

1. Add a subdomain the platform controls per tenant — `mail.{slug}.reservetoday.app`
   — and publish SPF and DKIM for it in the `reservetoday.app` zone. That is DNS
   we own, so it needs nothing from the studio, and it is a strictly better
   envelope than the shared one.
2. For a studio that wants its *own* domain on the envelope, give it the two
   records to publish (an SPF include and a DKIM CNAME), verify them from the
   super portal, and only then write `mail_from_email`. The verification step is
   the load-bearing part: an unverified domain must never reach the envelope.

Both steps change which address `PLATFORM_MAIL_FROM_EMAIL` resolves to for a
given tenant. Neither changes the shape of what the application sends, because
the display name and `Reply-To` are already per-tenant.

## Environment

| Var | Where | Meaning |
|---|---|---|
| `SMTP_USER` / `SMTP_PASSWORD` | secrets | The Gmail account and App Password the transport authenticates with. |
| `MAIL_FROM_EMAIL` | repository variable | The envelope address. Must be one the credentials are authorised for. Blank falls back to `SMTP_USER`. |
| `MAIL_FROM_NAME` | repository variable | Display name used only when a tenant has no name of its own. Defaults to `ReserveToday`. |

Per repo convention these land in `.github/workflows/deploy-be.yml`,
`be/.env.example` and `be/src/env.ts` together.
