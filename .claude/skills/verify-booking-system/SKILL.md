---
name: verify-booking-system
description: Prove a change works in the real running booking system — backend, member app (fe-client), staff portal and super portal (fe-portal) — by launching a throwaway local stack with its own database, Stripe stub and e2e studio, driving it in Chromium as a member, admin, instructor or platform operator, and keeping screenshots, ARIA snapshots, traces and database rows as evidence. Use to verify a feature or fix before a PR is ready, to reproduce a bug on the real surface, or when /pstack:maintain-verification-skill audits this map.
---

# Verify the booking system

One command starts everything a user touches, on this machine, from an empty database. You drive it with a short Playwright script, and every drive leaves its evidence in a run folder outside the repo that outlives the stack.

All commands run from the repo root. Node and Docker are required; nothing else is installed by the skill.

```sh
S=.claude/skills/verify-booking-system/scripts
node $S/stack.mjs up                  # launch; prints READY and the URLs
node $S/stack.mjs doctor              # is this instance worth driving? exit 0 = yes
node $S/drive.mjs <drive.mjs>         # one drive, evidence kept
node $S/stack.mjs sql "select …"      # read-only query on the run's database
node $S/stack.mjs studio              # a second studio, for tenancy checks
node $S/stack.mjs restart-be          # after editing be/src
node $S/stack.mjs down                # stop what up started; evidence stays
node $S/stack.mjs where               # the run folder
```

PowerShell: replace `$S/` with the full path, e.g. `node .claude/skills/verify-booking-system/scripts/stack.mjs up`.

## What `up` builds

| Piece | Where | Notes |
|---|---|---|
| Postgres | Docker container `reservetoday-db`, port from `POSTGRES_PORT` in `be/.env` | Started with `docker compose` only if it was not running; `down` stops it only then. |
| Database | `reservetoday-verify`, dropped and recreated on every `up` | Migrated and seeded from scratch. The dev database `reservetoday` and the test databases are never touched. |
| Stripe stub | `127.0.0.1:12111` (API), `:12443` (checkout page) | `e2e/src/stripe-stub.ts`, long-lived. No real Stripe or R2 key reaches the run. |
| Backend | `:4000`, `NODE_ENV=test` | Mail goes to the null transport **and** is written to `email_log`. Runs `be/src` as it was at start: it does not hot-reload. |
| Member app | `next dev` on `:3000` | Hot-reloads. A page compiles on its first visit (10–60 s). |
| Staff + super portal | `next dev` on `:3001` | Same. |
| Studio | `e2e-<random>`, made by `npm run e2e:studio -- setup` (`be/src/e2e/studio.ts`) | Staff, ten members, a package, classes, a workshop, PT, corporate and merch. Its JSON is `studio.json`. |
| Super portal operator | `delivered+verify-super@resend.dev` | Given a password by `scripts/super-admin.ts` (scaffolding: the real first sign-in mails a link nobody can read under the null transport). The password is in `state.json`. |

`up` takes 2–4 minutes. Ready means `[verify] READY`. Before printing it, `up` checks every port is held by its own process, the backend serves the studio from `reservetoday-verify`, the admin can sign in, and all three hostnames answer. If it fails, read the log it names, run `down`, fix the cause and run `up` again.

**One stack per machine.** The ports are fixed (the frontends' `.env.local` point at `localhost:4000`). `up` refuses when any of 3000, 3001, 4000, 12111 or 12443 is taken, and names the PID. Never kill that PID unless you started it: it is likely a developer's `make dev` or another agent's run. Ask the human. Two agents must not drive one stack at once: they share a studio and will race each other's bookings.

The run folder is `<os tmp>/verify-booking-system/<run-id>/` (`stack.mjs where` prints it):

```
state.json      pids, listeners, ports, the super operator's password, source fingerprint
studio.json     the studio: slug, urls, staff, members (with session tokens), catalogue, classes
studio-2.json   from `stack.mjs studio`
logs/           migrate, seed, studio, stub, backend, client, portal
evidence/       one folder per drive
```

## Doctor

`node $S/stack.mjs doctor` is read-only. Run it before the first drive, after any failed drive, and whenever something looks off. Every line must be `ok`:

- container running; each PID alive; each port held by the PID recorded at `up` (not just "something answers");
- `/health` says `db: ok`; the stub answers;
- the backend serves **this studio's** classes (it exists only in `reservetoday-verify`, so this proves which database the server reads);
- the studio admin can sign in;
- both frontends answer for the studio's hostnames;
- the stub logged no `UNHANDLED` call (the app asked Stripe for something the stub doesn't play: add it to `e2e/src/stripe-stub.ts`, never work around it);
- `backend runs the current be/src`: a `warn` here means you edited `be/src` since start. Run `restart-be`. A new migration needs `down` then `up`.

A process that died, or a port held by a different PID, means `down` then `up`. Do not drive around it.

## Drive

A drive is an ES module run by `drive.mjs` in Chromium, set up as the e2e suite sets it up: Stripe hosts resolve to the stub (`--host-resolver-rules`), certificate errors are ignored, the timezone is `Asia/Singapore`, the locale `en-SG`, and each page gets its own `x-forwarded-for` (the backend rate-limits per address).

```js
// <scratch>/my-drive.mjs
export default async ({ page, studio, signInMember, signInStaff, signInSuper, visitSignedOut,
                        newPage, loadStudio, step, shot, aria, sql, save, expect }) => {
  step('what the user does')                     // goes to steps.log
  await signInMember(page, studio.members.canceller)   // call before the first goto
  await page.goto(`${studio.urls.client}/account/packages`)
  await expect(page.getByText(studio.catalogue.packageName, { exact: true })).toBeVisible()
  await shot('packages'); await aria('packages')
  sql('credits', `select credits_or_sessions_remaining from client_packages where tenant_id = '${studio.tenantId}'`)
}
```

```sh
node $S/drive.mjs <path>/my-drive.mjs [--name label] [--headed]
```

Exit 0 is pass, exit 1 is fail. Either way the evidence is written.

| Helper | Does |
|---|---|
| `signInMember(page, m)` | Puts `m.token` in `localStorage['rt.client.session']`, as the member app keeps a session. Members: `studio.members.{buyer, canceller, lateCanceller, arriver, waiter, newcomer, shopper, merchBuyer, returner, holder}`; see `be/src/e2e/studio.ts` for what each holds. For the real `/login` form use the email and `studio.memberPassword`. |
| `signInStaff(page, p)` | The portal's own form at `/login`: Email, **Continue**, Password, **Sign in**. `p` is `studio.staff.admin` or `studio.staff.instructor`; the admin lands on `/admin`, the instructor on `/instructor/schedule`. |
| `signInSuper(page)` | The same form at `http://admin.portal.localhost:3001/login`; lands on the Studios page. |
| `visitSignedOut(page)` | An anonymous visitor with its own address. |
| `newPage()` | A second person on a second device, in a fresh context (e.g. admin and instructor side by side). |
| `loadStudio(2)` | The studio from `stack.mjs studio`. |
| `shot(name, page?)` | Full-page PNG. |
| `aria(name, pageOrLocator?)` | The ARIA snapshot: what an assertion and a screen reader see. |
| `sql(name, query)` | Read-only query on `reservetoday-verify`, saved as `sql-*.txt` and returned as text. It connects as the owner, so RLS does not apply: always filter by `tenant_id`. |
| `save(name, data)` | Any other artifact. |

Selectors: use roles and accessible names (`getByRole('button', { name: 'Book class' })`), labels and visible text, as `e2e/journeys/*.spec.ts` does. Copy a locator from there before inventing one. Never use coordinates, CSS classes or tab order. Read values from `studio` (slug, emails, class names); they are new every run.

Proven drives ship in `../drives/`. Run them as they are, or copy one to scratch and adapt it. Write one-off drives in your scratch directory, not in the repo.

For exploring by hand instead of a script, run `drive.mjs` with `--headed`, put `await page.pause()` in the script, and use the Playwright inspector. Or use Claude in Chrome on the same URLs. Chrome resolves `*.localhost` itself, but its Stripe pages go to real Stripe, so stop there.

## Evidence

Each drive writes `<run>/evidence/<label>-<hh-mm-ss>/`:

| File | What |
|---|---|
| `steps.log` | every `step`, artifact path, and the result |
| `NN-<name>.png`, `NN-<name>.aria.yml` | screenshots and ARIA snapshots, numbered in order |
| `sql-NN-<name>.txt` | the query and its rows |
| `console.log` | browser errors and warnings |
| `network.log` | every API response ≥ 400 and every failed request |
| `trace.zip` | the full Playwright trace: `npx --prefix e2e playwright show-trace <path>` |
| `failure.png`, `result.json` | the last screen on failure; pass/fail, error, HEAD, studio |

What counts as proof:

- **The real user path.** Click what a user clicks. No calling a service, setting state in the database, or using a test-only route to get to the state under test. Fixtures from `e2e:studio` are the starting state, not the proof.
- **The action and its result.** Capture the screen before and after, not just the end screen.
- **A second view of what was stored.** A toast is not proof: reload, or open the page that lists it (a receipt in `/account/receipts`, a class on the instructor's schedule), and query the rows it wrote (`purchases`, `stripe_payments`, `receipts`, `bookings`, `client_packages`, `credit_movements`, `email_log`, `audit_log`).
- **Email is checked in `email_log`** (`template_slug`, `recipient_email`, `subject_rendered`, `body_rendered`, `status`). Nothing reaches an inbox, and sign-in codes are redacted there.
- **Payments are the stub, not Stripe.** `4242 4242 4242 4242` pays and `4000 0000 0000 0002` is declined. The stub returns no card details, so `stripe_payments.method` and `card_last4` stay empty here. Stripe webhooks are never delivered; the confirmation page's sync is what grants. A behaviour that depends on a webhook or on real card data is **not verified** by this stack: say so.
- Report the evidence folder path and the drive's `RESULT` line with every claim.

## Cleanup

```sh
node $S/stack.mjs down
```

`down` kills the process trees it started, by recorded PID (never by name), and anything still holding a port under a recorded PID. It then drops `reservetoday-verify` and stops the Postgres container only if `up` started it. It never deletes the run folder. Afterwards, check that `stack.mjs where` shows `"stopped": true` and that the evidence folder still lists your files. Run `down` after every failed `up` too, so a half-started stack doesn't hold ports.

Old run folders under `<os tmp>/verify-booking-system/` are kept until someone deletes them by hand. Don't delete one whose evidence a PR or report still cites.

## Gotchas

- **`NODE_ENV=test` makes the backend skip `be/.env`** (`be/src/db/url.ts`), so `NODE_ENV=test npm run start` in `be/` fails with "Environment validation failed". `stack.mjs` parses `be/.env` itself and passes it in. Don't start the backend by hand.
- **The `booking_app` role's password is shared by every database on the cluster**, and every migration rewrites it. Test runs set it to `booking_app_test`, `make init` to `booking_app_dev`. `up` probes which one works now and keeps it, so it won't lock out another checkout's tests or a `make dev` backend.
- **e2e studios are hidden from the super portal's studio list**, so super portal journeys act on a studio they create themselves (`features/super-portal-studios.md`).
- **The super operator's 2FA** is not enrolled. A drive that enrols it locks later drives out until the next `up`.
- **First compile.** The first visit to each Next page can take a minute in dev mode. Give the first `expect` on a new page a timeout of 60 s.
- **Receipts frame console noise.** "Blocked script execution in 'about:srcdoc'" in `console.log` comes from the sandboxed receipt frame. It is expected.
- **Receipt numbers start at `R-000002`** for the buyer: the studio's setup already issued `R-000001` (the holder's free workshop place).
- **If a frontend's log holds only `[?25h`**, the dev server exited at start. `up` now fails fast on this; run `down` and `up` again. It happened once while this skill was being written, and didn't come back.
- **A commit from another session** moves HEAD without touching `be/src`. Doctor notes it but doesn't warn. Only a change to `be/src` makes the backend stale.

## Feature map

[`features/README.md`](features/README.md) indexes one file per user-facing feature: what it is, how a user reaches it, how to drive it with this skill, and its gotchas. A verification of a feature covers every entry point its file lists, not just the most convenient one. When a journey's precondition is missing from the studio, the journey fails and the reason goes in that file's Gotchas. Never weaken the journey.

Keep the map honest with `/pstack:maintain-verification-skill`.
