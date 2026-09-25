# A Tenant supplies its own payment-provider credentials

**Status**: accepted (2026-09-07) — replaces the Stripe Connect plan recorded in `docs/md/multi-tenancy-plan.md`, which is overturned rather than deferred. **Partly superseded** by `0007-every-studio-sells-on-its-own-account.md` (2026-09-25): the platform-account fallback, the shared webhook endpoint and the statement descriptor suffix are gone. The rest stands.

Every studio on this platform charges on the platform operator's own payment account. That was always meant to be temporary: each studio would open a **connected account** through Stripe Connect, the platform would take an application fee, and money would land in the studio's own bank.

It cannot. Stripe does not let a platform in one country collect application fees on connected accounts in another: a Malaysian platform may only do so for connected accounts in Malaysia. Blueprint Agency is Malaysian and Tenant #1 is Singaporean, so the first studio to be moved is precisely the one the model refuses. Incorporating a Singapore entity would fix it and is a company decision with a cost and a timeline, not an engineering one.

## Each studio is charged against directly

A Tenant holds the credentials to **its own** payment-provider account — the secret key and the webhook signing secret — and every call made on that studio's behalf is made against that account.

There is no platform account in the middle. No connected account, no hosted onboarding link, no application fee, no `Stripe-Account` header. A studio's money is taken on the studio's own account and lands in the studio's own bank, because the account *is* the studio's. The platform's cut, whatever it becomes, is a bill the studio pays — not a slice taken out of a member's payment in flight.

An account is therefore a **key**, not a header. That is the whole difference from Connect in one line, and it is why the client is built with the studio's credentials rather than a per-call parameter: a call site cannot half-belong to a studio.

## A Tenant with no credentials still charges on the platform account

> **Superseded** by `0007-every-studio-sells-on-its-own-account.md`: a Tenant with no credentials now takes no online payments at all.

`providerAccountForTenant` answers `null` for a studio that has supplied nothing, and `null` means the platform's account — where every studio sold before this and where every studio still sells until it is moved.

This is not a fallback bolted on for safety; it is what makes the change deployable. Studios are onboarded one at a time, each one an independent act, and the studios behind it are not waiting on anything. The first studio's credentials are configurable from the day this ships and its selling is unchanged until somebody sets them.

The one place that refusal must not be silent is a studio whose credentials exist and cannot be opened — a rotated key, a tampered row. Falling back there would take that studio's members' money onto the platform's account: a silent misdirection of somebody else's revenue, which is worse than a failed checkout by a wide margin. So it throws.

## The credentials are a secret held on somebody else's behalf

Holding a connected-account id is bookkeeping. Holding a studio's live payment key is a materially different responsibility, and the design says so in four places:

- **Encrypted at rest** (AES-256-GCM, `src/lib/secret-box.ts`), with the key in the environment. A database backup is then not a set of live payment keys, and a leaked key is not a database. GCM rather than a bare cipher because a credential that can be *altered* undetected is as bad as one that can be read.
- **Not serialisable.** The secrets are non-enumerable properties on the object the accessor hands out, so `JSON.stringify` skips them, a log line skips them, and a Sentry event's serialiser skips them. The ordinary accidents — `logger.info({ credentials })` while debugging, an exception carrying the object, a route spreading it into a response — cannot disclose them. Reading one requires naming the property, which somebody has to mean.
- **Returned by nothing.** There is no read-back route, not masked and not last-four. The super portal shows that credentials exist and which account they name, and that is the whole of it. Credentials that need checking are replaced; credentials that were wrong are cleared.
- **Validated when set.** The key is checked against the provider before it is stored, and the account id is taken from the provider's answer rather than from whoever pasted it. So a typo is a message on that form, and not a member's checkout failing weeks later against a key nobody can look at.

The signing secret is deliberately *not* validated, because the provider offers no way to ask. It is proved by the first delivery that verifies against it.

## Webhooks: the studio is settled before the signature is checked

This is the half that does not fall out of the accessor.

The shared endpoint works in one order: one signing secret verifies every delivery, and *which studio* is worked out afterwards, from the signed body. A studio charging on its own account signs with its own secret, which inverts that. The studio has to be settled **first**, because it is what selects the secret — and the body is exactly what cannot be trusted yet.

So a studio's deliveries arrive on a URL of their own, `/api/v1/webhooks/stripe/{slug}`, registered on that studio's account. The URL is the only part of a delivery that is fixed before the body is read.

One secret is then tried, and only one. A delivery signed by another studio's account does not fall through to a second attempt, to the platform's secret, or to a scan of every studio — it fails and is refused. That is what makes a cross-studio delivery impossible rather than merely unlikely. The handler is additionally told which studio the URL named, so a body that routes elsewhere is refused rather than acted on.

The guard is applied to **every** event type, not only the one that grants. A refund unwinds a purchase, and a studio able to unwind its neighbour's is the same breach read backwards — with its own signing secret it could mint a `charge.refunded` for any payment intent it could name. So the handler asks which studio the body routes to before it does anything, and refuses a mismatch whatever the event is.

Every refusal on that endpoint is the same flat 400 — an unknown slug, a studio with no account of its own, and a bad signature alike. An endpoint that distinguished them would let anyone holding a URL enumerate which studios exist and which of them take their own money.

## Two things this changes that nobody asked for

**A studio on its own account sends no statement descriptor suffix.** The suffix exists because the platform's shared account carries the platform's name, and appending the studio's is the only way a member sees who they paid. On a studio's own account it is redundant — the statement already says the studio — and it is a live risk, because the 22-character limit is measured against *that* account's prefix, which this platform does not know and cannot read reliably. A missing suffix costs a nicety; a refused charge costs the sale.

**Credentials can be cleared, not only set.** The spec asks for set-and-replace. Clearing is here because it is the only recovery from credentials that turn out to be the wrong studio's: the obvious fix — look at what is stored — does not exist by design, so without this a mistake would be unfixable except by replacing it with something else that also cannot be checked. It is confirmed in the browser and destroys nothing but the credentials.

## What this costs

**A key rotation is manual.** `PAYMENT_CREDENTIALS_KEY` seals every stored credential, so rotating it orphans all of them and each studio's have to be entered again. There is deliberately no second key to fall back to: a decryption that quietly succeeds under an old key is how a rotation gets abandoned half-done.

**The platform's revenue is a bill, not a fee.** Nothing is deducted in flight any more, so charging studios for the platform is a commercial process that does not exist yet. That is the real price of this decision and it is the company's to pay; the alternative was a Singapore entity.

**Two webhook endpoints exist at once,** and will for as long as any studio is still on the platform account. The shared one is not deprecated — it is what an un-moved studio uses, correctly.

**A studio can be half-configured.** Credentials set and the webhook endpoint not yet registered on its account means purchases are charged and nothing is granted. The super portal shows the URL immediately after a save for exactly this reason, but nothing on this platform can detect the omission — only the studio's own account can say whether the endpoint exists.
