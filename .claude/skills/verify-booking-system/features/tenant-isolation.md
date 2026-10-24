# Tenant isolation

Each studio is a Tenant: its members, sessions, classes and pages are invisible from every other studio, whether reached through another studio's hostname, a forged `X-Tenant-Slug` header, or another studio's ids (`docs/md/spec-tenant-resolution.md`, `docs/adr/0006-per-studio-logins.md`).

## Sub-features

- `iso-session` refuses a member's session at another studio with 401 `invalid_token`.
- `iso-mismatch` refuses a request whose `X-Tenant-Slug` disagrees with its `Origin` with 403 `tenant_mismatch`.
- `iso-ids` refuses another studio's record by id with 404, not its data.
- `iso-browser` shows another studio's member app as signed out when a foreign token is in its storage.
- `iso-staff` refuses studio A's staff session on studio B's portal (same rules as members).

## How to get to it (user POV)

- Open studio B's member app or portal while signed in to studio A.
- Put a studio-B id into a studio-A URL or request.
- Send a request naming one studio from another studio's page (a tampered client).

## Driving it with verify-booking-system

Preconditions:

- Doctor passes, then `node .claude/skills/verify-booking-system/scripts/stack.mjs studio` has made `studio-2.json`.

- **Whole journey.** Run `node .claude/skills/verify-booking-system/scripts/drive.mjs .claude/skills/verify-booking-system/drives/tenant-isolation.mjs`. `RESULT pass`; evidence holds `api-*.json` (request, status, body) and the browser screenshot.
- **Baseline.** `page.request.get(studio.urls.api + '/me')` with `x-tenant-slug: A`, `origin: A client`, `authorization: Bearer <A member token>`. Status 200, the member's own profile.
- **Session at B.** The same token with `x-tenant-slug: B`, `origin: B client`. Status 401, body `{"error":"invalid_token"}`.
- **Header and origin disagree.** `x-tenant-slug: B`, `origin: A client`. Status 403, body `{"error":"tenant_mismatch"}`.
- **Foreign id.** `GET /public/classes/<B's studio.classes.buy.id>` as studio A. Status 404, body `{"error":"class_not_found"}`, and nothing of B's class name.
- **Browser.** Put A's token in `localStorage['rt.client.session']` for B's client origin (`page.addInitScript`), open `B client /account`. B's name shows; A's member email does not.
- **Staff.** `signInStaff` on A's portal, then open `B portal /admin` in the same context. B's portal asks for sign-in; no B data loads. `network.log` shows the refusals. (Not yet in the drive; add it there when first run.)

## Gotchas

- `studio.urls.api` already ends in `/api/v1`: request `/me`, not `/api/v1/me`.
- The `sql` helper connects as the owner, which bypasses Row-Level Security. Never use it to prove isolation; prove it through the app's own API and pages.
- e2e studios cannot be opened from the super portal, so cross-studio checks through the super portal need a studio created there (`super-portal-studios.md`).
