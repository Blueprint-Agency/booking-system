# Member data retention

What a studio keeps about a member after it **permanently deletes** them, why, and for how long (#144).

A member can ask a studio for their data (**Download data**, #143) and to be deleted. Deletion is `DELETE /portal/admin/clients/:id/permanently` (`be-portal.md` § `clients.ts`), admin only. It sits beside **Block**, which stays the reversible option: blocking hides and locks out a member and erases nothing.

## The rule

**Everything the studio holds that names the member is deleted, except its accounts.** The accounts stay, with the member's identity removed from them.

The tables and what deletion does to each are one list, `MEMBER_TABLES` in `be/src/services/clients/member-tables.ts` — the same list the export reads, so the two cannot disagree about where a member lives. Each entry's `erase` steps are this document in code; a guard test fails when a schema column names a member and the list does not know it.

### Deleted

| What | Tables |
|---|---|
| The member's profile at this studio | `clients` |
| Bookings, cancellations, check-ins | `bookings`, `cancellations`, `check_ins` |
| Manual credit adjustments (credit movements with a staff member's free-text reason — no money, and the reason may name the member) | `manual_adjustments` |
| Waiver signatures | `waiver_signatures` |
| Their PT requests and proposed slots, and their place on PT sessions | `pt_requests`, `pt_request_slots`, `pt_session_clients` |
| Corporate enquiries | `corporate_requests` |
| Mail sent to them — by member id, or by address for mail sent before one existed, such as a sign-in code — and notifications about them | `email_log`, `inbox_items` |
| The staff audit trail about them: actions on their profile, actions whose path runs through their profile (their packages, bookings, refunds), actions taken while impersonating them | `audit_log` |
| Their sign-ins and staff acts on their account, at this studio | `auth_events` |
| Their sessions at this studio | `client_auth_sessions` with this studio's claim |
| Their sign-in account — **only if no other studio still has them** | `client_auth_users`, with its sessions and credentials |

### Kept, identity removed

| What | Table | What is removed |
|---|---|---|
| Payments and refunds | `stripe_payments` | `client_id`; `booking_id` (the booking is deleted); `receipt_url` (the receipt page shows who paid) |
| Package sales — list price, amount paid, the Cross-Location Add-On | `client_packages` | `client_id`; the package is marked inactive |
| Promo Code uses — the money taken off, and a use against the code's limit | `promo_code_redemptions` | `client_id` |
| Merch sales | `merch_orders` | `client_id` |

**Why:** these are the studio's financial records. A studio has to be able to account for money it took and gave back, and to reconcile against the payment provider — which is why `payment_intent_id` stays: it matches a row to the provider's own record without naming anyone here. Nothing kept holds a name, email or phone.

**For how long:** as long as the studio's accounting records must be kept. For a Singapore studio that is **five years** from the end of the financial year the transaction falls in (IRAS record-keeping requirements); a studio elsewhere follows its own jurisdiction. There is **no automatic purge** of these rows yet — they carry no identity, so keeping them longer discloses nothing about the member, but a studio that must destroy records after the period has to be given that job separately.

### Someone else's rows that named the member

These are not the member's, so they stay; only the reference to the member goes.

| What | Table | What is removed |
|---|---|---|
| Another member's 2-on-1 request that named this member as partner | `pt_requests` | `co_client_id` |
| A PT session scheduled from the member's request — the instructor's session, which their pay and any partner's booking hang off | `pt_sessions` | `pt_request_id` |

## Across studios

One person is one sign-in account at every studio they have joined; each studio holds its own `clients` row. A studio deletes **its** record of the member and nothing at another studio. The sign-in account is deleted only when no studio still has a member row for it — the check is `client_auth_user_is_member` (migration `0060`), which answers yes or no across studios without telling the asking studio which. The response does not say whether the account went either, for the same reason.

## What records the deletion

An `auth_events` row, kind `member_deleted`, filed under `staff` at this studio: the acting staff member as actor, **no subject**, their address and user agent. The `audit_log` row for the request records the route pattern (`/clients/:id/permanently`), not the member's id. The act is on record; who it was about is not.

## Not covered

- **Backups.** A deleted member remains in database backups until those backups age out.
- **The payment provider and the mail provider** keep their own records under their own retention; deletion here does not reach them.
- **Other studios' sign-in logs.** A failed sign-in at another studio is that studio's record.
