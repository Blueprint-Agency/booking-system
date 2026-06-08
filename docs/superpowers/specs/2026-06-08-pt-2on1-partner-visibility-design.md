# 2-on-1 PT — partner sees the session in their account

**Date:** 2026-06-08
**Status:** Approved
**Scope:** `be/` + `fe-client/`

## Problem

When a client requests a **2-on-1** PT session they name a partner — either an
existing member (`pt_requests.co_client_id`) or a not-yet-member
(`co_client_name` + `co_client_email`). At scheduling time both attendees get a
`pt_session_clients` row and **their own `bookings` row with a QR/check-in code**.

But the client-facing list query only ever returns requests where the caller is
the **requester**:

```
be/src/services/pt-sessions/list.ts:58
  .where(eq(ptRequests.clientId, clientId))
```

So the partner never sees the request (pending) or the scheduled session in their
own account — even though they have a real booking + QR. This spec closes that gap.

## Goal

An **existing-member partner** sees the 2-on-1 in their own account:
- `pending` → shown as "requested"
- `scheduled` → shown as "confirmed", with **their own** QR/check-in code
- **read-only**: the partner cannot cancel or reschedule (only the requester, who
  owns the debited credits, can).

A **not-yet-member partner** is handled implicitly: they have no account to log
into until an admin creates one. Creating that account + back-filling
`co_client_id` is **already mandatory** before a 2-on-1 can be scheduled
(`schedule.ts` returns `partner_account_required` otherwise). Once back-filled,
the partner becomes an existing-member partner and the session appears
automatically. No extra onboarding/email work this round.

## Non-goals (explicitly locked)

- No partner "withdraw / leave the session" flow.
- No proactive new-partner email invite / admin onboarding task (the P8 gap stays open).

## Design

Extend the **existing** list service + the one account page. Do **not** add a
parallel "as-partner" endpoint — the booking lookup already keys off
`bookings.client_id`, so a partner naturally receives *their own* QR row.

### Backend

**`be/src/services/pt-sessions/list.ts` — `listClientPtRequests(clientId)`**
1. Widen the filter to `or(eq(ptRequests.clientId, clientId), eq(ptRequests.coClientId, clientId))`.
2. Add an aliased join to `clients` to fetch the **requester's name** (`requesterName`).
3. Extend `ClientPtRequestView` with:
   - `role: 'requester' | 'partner'` — derived from `requesterClientId === clientId`.
   - `requesterName: string | null` — the host's name (used by partner cards).
4. For `role === 'partner'`, blank `message` (the requester's private note to the
   instructor is not the partner's to read).
5. The existing per-client booking batch (`bookings.client_id = clientId`) is
   unchanged — for a partner it returns the partner's own booking/QR.

**`be/src/routes/client/pt-sessions.ts` — `serializeRequest`**
6. Emit `role` and `host_name` (`= requesterName`).

**Cancel — no change.** `cancel.ts:63` already rejects any non-requester with
`ForbiddenError('not_your_request')`, so view-only is enforced server-side
regardless of the UI.

### Frontend (`fe-client`)

**`src/lib/pt-sessions.ts`**
7. Add `role?: 'requester' | 'partner'` and `host_name?: string | null` to `RawPtRequest`.

**`src/app/(client)/account/private-sessions/page.tsx` — `RequestCard`**
8. When `role === 'partner'`:
   - Replace the "Partner: {co_client_name}" line with "You're the partner · hosted
     by {host_name}".
   - Hide the Cancel button (`canCancel = role !== 'partner' && (pending || scheduled)`).
   - QR/code block and the status tabs already work unchanged (partner's own
     booking + status-based filtering).

The unrelated instructor-profile booking page (`private-sessions/[id]/page.tsx`,
mock data) is **out of scope**.

## Edge cases

- A client can be requester on one request and partner on another — the `OR`
  returns both; no row duplication since `client_id != co_client_id` on any row
  (`lookupPartnerByEmail` excludes self).
- Partner sees pending requests immediately at submit (`co_client_id` is set at
  submit time for existing members), satisfying the "requested" requirement.
- Proposed slots on a pending request are shown read-only to the partner (no
  cancel, no edit).

## Verification

- `be/`: `npx tsc --noEmit` (no BE test infra — typecheck is the gate).
- `fe-client/`: `npx tsc --noEmit` + `npx next build` (lint is known-broken).
- Update `docs/md/be-client.md` §PT to document the new `role` / `host_name` fields.
