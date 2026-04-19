# Yoga Sadhana Admin Portal (mockup)

Clickable frontend-only admin portal for Yoga Sadhana staff. Sibling app to `../fe/`.

## Development

```bash
npm install
npm run dev         # → http://localhost:3100
```

## Seeded admins

Log in with any of the seeded emails (any password works):

- `priya@yogasadhana.sg`
- `arjun@yogasadhana.sg`

Reset the local mock state from the browser console:

```js
localStorage.removeItem("admin-mock-state:v1");
location.reload();
```

## Phase map

- **Phase 1 (shipped):** shell, login, dashboard, UI primitives, seed data, all remaining routes as `ComingSoon` placeholders.
- **Phase 2:** schedule, bookings, check-in, private-session requests.
- **Phase 3:** clients, catalog, instructors, locations.
- **Phase 4:** invoices, reports, notifications, waivers, referrals, settings.

See `../docs/md/prd-admin.md` for the product spec and `../docs/md/plans/` for phase plans.
