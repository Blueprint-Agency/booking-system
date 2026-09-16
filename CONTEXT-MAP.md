# Context Map

The booking platform is three decoupled applications. They share no code — only the HTTP contract.

It is multi-tenant: one deployment of each app serves every studio. A studio is a **Tenant**, resolved per request from the hostname, and the backend refuses to answer for a Tenant the caller cannot evidence. No studio is named in the repo — a studio is data, and arrives through the super portal.

## Contexts

- [Backend](./be/CONTEXT.md) — the domain. Owns every rule: booking, credits, scheduling, leave, payments.
- Portal (`fe-portal/`) — the staff surface. Admin and instructor views over the backend's portal routes. _(No `CONTEXT.md` yet — nothing has needed one.)_
- Client (`fe-client/`) — the member surface. Browsing, booking, packages, workshops. _(No `CONTEXT.md` yet.)_

## Relationships

- **Portal → Backend**: HTTP only, `/api/v1/portal/{admin,instructor}/*`. Signs in on the `staff` auth pool (`/api/v1/auth/staff`); the super portal on the `platform` pool.
- **Client → Backend**: HTTP only, `/api/v1/me/*` and `/api/v1/public/*`. Signs in on the `client` auth pool (`/api/v1/auth/client`) — a separate pool; a token from another pool is refused on purpose. See `docs/adr/0004-self-hosted-auth-with-better-auth.md`.
- **Portal ↮ Client**: no relationship. They never talk, share no types, and are deployed independently.

- **Tenant resolution**: each frontend reads the Tenant slug from its own hostname and sends it on as `X-Tenant-Slug`; the backend treats that as a claim, not a fact, and corroborates it against the browser `Origin` or the Tenant claim on the caller's session. Inbound `x-tenant-*` headers are stripped on every path through both proxies.

Every rule lives in the backend. Where a frontend appears to know a rule — the 13:00 half-day boundary in the portal's instructor picker, for instance — it is a deliberate, commented mirror, and the server refusal remains the enforcement.
