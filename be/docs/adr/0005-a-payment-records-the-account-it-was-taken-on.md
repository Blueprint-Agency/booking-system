# A payment records the account it was taken on

**Status**: accepted (2026-09-07) — completes `0004-tenant-supplied-payment-credentials.md`, which it does not overturn.

ADR 0004 gave a studio its own payment account and one question with one answer: `providerAccountForTenant` says where a studio's money moves. That answer is correct for a charge, which happens **now**, and wrong for a Refund, which happens **later** — possibly years later, and possibly after the studio has moved.

## A studio's history does not move with it

There is no way to hand a payment intent from one provider account to another. So when Yoga Sadhana's credentials are set, the sales it took on the platform's account stay on the platform's account — for as long as anybody might want to read, report or return one, which is indefinitely.

Reading the studio's *current* credentials to refund one of those would send the call to an account where the intent does not exist. The member gets nothing back, and the admin gets an error naming an id that looks perfectly correct. Nothing about the failure points at the cause.

So the account is written down at the moment it is true, on `stripe_payments.provider_account_id`, and `stripeForProviderAccount` resolves a client from *that* rather than from the Tenant. `null` is the platform's own account — deliberately, and not "unknown": every payment taken before the column existed was taken there, because it was the only account this platform had, so the column's default is also its backfill.

The result is that a studio can hold payments on two accounts at once, and **one Purchase can too** — one card before the move and one after. Each is returned where it came in, and neither knows about the other. That is the shape the code carries; there is no cutover to assume.

## The account comes out of the signature check

The obvious source at capture time is "read the studio's credentials and store the account id". Taking it from the signature check is better, and it is free.

`verifyTenantDelivery` already loads a studio's credentials to check the signature, and a delivery that verifies has been *proved* to come from that account — the secret that verified this body is that account's secret. So the account is returned alongside the event and carried into the handler, which stamps it onto every payment the delivery writes. The shared endpoint passes `null`, the platform's own, by the same argument: the platform's secret verified it.

Looking the credentials up again in the handler would be a second, unproved answer to a question already settled, and it would be the wrong one in exactly the case that matters. A member begins a checkout, the studio's credentials are saved, the member then pays: the session belongs to the platform's account and delivers to the platform's endpoint, so the platform's secret verifies it and `null` is stamped — which is where the money is. A fresh lookup would say "the studio's own account" and route a future refund to an account the money never reached.

The receipt lookup is resolved from the same value and for the same reason, since it retrieves that same intent.

## An account no key is held for throws

`stripeForProviderAccount` refuses an account this platform holds no credentials for rather than falling back to the platform's. It is the same argument 0004 made about credentials that will not open: the platform's key cannot reach that intent either, so a fallback turns a legible failure into a confusing one, and a refund that silently does not happen is worse than one that says so.

Which is a real constraint and worth stating plainly: a Tenant holds **one** set of credentials, so it can reach exactly two accounts — the platform's, and whichever one it supplies today. Two migrations are one too many. A studio that moves from the platform to account A and later to account B leaves everything taken on A unreachable, and the refund for it says so rather than misfiring. Recovery is to put A's credentials back for as long as the refund takes, which is a manual act somebody has to know about.

That ceiling is deliberate for now. Holding several accounts per studio is a different design — a credentials *history* rather than a credentials row — and nothing on this platform has needed the second move yet.

## Finance needed no change, and that is the point

Every payment and every Refund is a row in this database whichever account it moved on, so the ledger reads across the migration boundary without knowing there is one. Refund rows are windowed on `refunded_at` and excluded for `open`/`abandoned` purchases exactly as before; nothing sums by account, and nothing needs to. No double counting and no gap, because the boundary is invisible to the query.

## What this costs

**A payment's account is a fact that can rot.** It is written from the endpoint at capture and never revisited, so a row written before this migration says `null` whether or not that was checked. That is correct for every existing row — the platform account is the only one that existed — but it is a claim resting on history rather than on a check, and the next platform-level account change would have to say so itself.

**A studio's credentials cannot be swapped for another studio's and remain refundable.** Clearing credentials (0004's recovery path) leaves any payments taken on that account unrefundable through this platform until the right credentials are restored. That is the correct failure, but it is a failure, and the super portal does not yet warn about it.

**A checkout session in flight when a studio moves is not covered.** A payment records its account; a *session* does not, because nothing stores one. So the two calls that act on an existing session — `/checkout/sync-session` and `expirePredecessor` in `open-purchases.ts` — still ask the studio's current credentials, and for the few hours after a move they can be asking the wrong account. The member sees a confirmation page that falls back, or is told their previous payment page is still open and to try again; the webhook still grants, and the payment is still recorded on the right account and still refundable. Closing it properly means recording the account beside `purchases.checkout_session_id`, which is a column this ticket did not need.
