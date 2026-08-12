# Context Map

Yoga Sadhana's booking platform is three decoupled applications. They share no code — only the HTTP contract.

## Contexts

- [Backend](./be/CONTEXT.md) — the domain. Owns every rule: booking, credits, scheduling, leave, payments.
- Portal (`fe-portal/`) — the staff surface. Admin and instructor views over the backend's portal routes. _(No `CONTEXT.md` yet — nothing has needed one.)_
- Client (`fe-client/`) — the member surface. Browsing, booking, packages, workshops. _(No `CONTEXT.md` yet.)_

## Relationships

- **Portal → Backend**: HTTP only, `/api/v1/portal/{admin,instructor}/*`. Staff Clerk app.
- **Client → Backend**: HTTP only, `/api/v1/me/*` and `/api/v1/public/*`. Client Clerk app — a separate Clerk application; cross-app tokens are rejected on purpose.
- **Portal ↮ Client**: no relationship. They never talk, share no types, and are deployed independently.

Every rule lives in the backend. Where a frontend appears to know a rule — the 13:00 half-day boundary in the portal's instructor picker, for instance — it is a deliberate, commented mirror, and the server refusal remains the enforcement.
