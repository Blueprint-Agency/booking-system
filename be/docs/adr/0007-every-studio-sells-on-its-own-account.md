# Every studio sells on its own payment account, and the platform account is gone

**Status**: accepted (2026-09-25) — supersedes the section "A Tenant with no credentials still charges on the platform account" of `0004-tenant-supplied-payment-credentials.md`, and with it that ADR's two-endpoint and statement-descriptor consequences. The rest of 0004 stands: sealed credentials, no read-back, validation when set, and per-studio webhook routing. It also narrows what `null` means in `0005-a-payment-records-the-account-it-was-taken-on.md`.

ADR 0004 kept the platform's own Stripe account as the place a studio sold until it supplied credentials of its own. That was what made onboarding one studio at a time possible, and it has done its job. It has also become the thing most likely to go wrong: a studio whose credentials were never entered does not fail, it quietly sells on an account that belongs to nobody it knows, under a descriptor its members have never heard of, into a balance the platform then owes the studio. The platform's live account was never even activated, so in production that "working state" was a checkout that could not take money at all.

## A studio with no credentials takes no online payments

`providerAccountForTenant` still answers `null` for a studio that has supplied nothing — but `null` now means **no online payments**, not "the platform's account". There is no platform key in the environment to build a client with, so there is nothing to fall back to even by accident.

- A checkout at such a studio is refused before a Purchase is opened: `409 payments_not_configured`, whose message is the sentence the member reads — "This studio isn't taking online payments yet." Nothing is charged anywhere.
- A **$0 purchase** is unaffected. It never reaches the provider; it is granted at quote time, before anything here is asked.
- The member app asks first (`GET /public/online-payments`) and shows that sentence in place of a paid buy button, so the refusal is the backstop rather than the experience.
- A Refund at a studio that has since removed its credentials is refused with the same code: nothing it holds can be reached.
- Credentials that exist and cannot be opened still **throw**, exactly as 0004 decided. Treating them as absent would switch a selling studio's payments off without a word.

In the super portal a studio with no credentials reads **Payments not set up**, and removing a studio's credentials is worded as what it now does: the studio stops taking online payments.

## Payments already on the platform account are refunded outside the app

ADR 0005 stamped `null` on a payment taken on the platform's account. Those rows still exist on staging (test payments) and should not exist in production, but the app no longer holds a key that could reach them. A Refund that includes one is refused up front — `409 payment_on_platform_account`, pointing the admin at the Stripe dashboard — before any of the Purchase's other payments are returned, because a Refund that stops half-way is worse than one that never starts.

The member's confirmation page records a payment too, when it lands before the webhook (`/me/checkout/sync-session`). It used to pass no account, which stamped `null` — the platform's — on a payment taken on the studio's own account. It now passes the account it read the session back with, so every new payment row names a real account and `null` is only ever history.

## What goes with it

- **The shared webhook endpoint.** `/api/v1/webhooks/stripe` existed for the platform account; only `/api/v1/webhooks/stripe/{slug}` remains. The webhook handler now always knows the studio and the account before it acts.
- **The statement descriptor suffix.** It was the only way a member saw the studio's name on the platform's shared statement. On a studio's own account the statement already says the studio, and the 22-character limit is measured against a prefix this platform does not know. So no suffix is sent, and the boot check that nagged about the prefix is gone with it.
- **Three environment variables:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STATEMENT_DESCRIPTOR_PREFIX`. `PAYMENT_CREDENTIALS_KEY` stays, and a deploy now refuses to proceed without it: it is what every studio's credentials are sealed with, so without it no studio can sell.

## What this costs

**A studio sells nothing until its credentials are entered.** That is the point, but it moves a step from "nice to have" to "before launch": onboarding a studio now includes entering its credentials and registering its webhook endpoint, and a studio that skips it has a catalogue with no buy buttons.

**Old platform-account payments are a manual job.** Refunding one means the Stripe dashboard and a human, and the app's unwind only runs if that account's webhook still reaches it — which, with the shared endpoint gone, it does not. Production should hold none; staging's are test money and may be abandoned.
