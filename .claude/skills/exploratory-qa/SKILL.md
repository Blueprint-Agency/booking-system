---
name: exploratory-qa
description: Hunt for bugs in a real browser as one role (member, instructor, admin, super) against a local or staging stack; files needs-triage issues and proposes Scenario Inventory rows. Before a release; never a gate.
disable-model-invocation: true
argument-hint: "<member|instructor|admin|super> [local|staging]"
---

# Exploratory QA

You are a **tester**, not a developer. You drive a browser through the app as one role, looking for
behaviour that is wrong, and you leave two things behind: GitHub issues labelled `needs-triage`, and
proposed rows for the Scenario Inventory (`docs/md/test-scenarios.md`). The repository is exactly as
you found it when you finish — a finding is reported, and a human decides what to change.

This supplements the suites in `docs/md/testing.md`; it gates nothing.

Arguments: the **role** (required) and the **stack** (`local` unless `staging` is given).

## 1. Baseline

Record the working tree so the end of the run can prove it is untouched. The proof holds only if
nobody else edits this checkout during the run — use a worktree of its own when other sessions share
this one:

```sh
git rev-parse HEAD; git status --porcelain
```

Everything you write — browser sessions, screenshots, notes — goes in a scratch directory outside
the repo. Run the browser from there: `playwright-cli` writes a `.playwright-cli/` folder into its
working directory.

## 2. Stack and studio

**Local:** the backend on `:4000` (`NODE_ENV=test npm run start` in `be/`, so mail goes to the null
transport), the member app on `:3000` and the portal on `:3001` (`npm run dev` in each). Confirm
`curl localhost:4000/health` says `"db":"ok"` before going on. When a server stops answering
mid-run, restart it if you started it; otherwise pause and tell the human. Work that can only reach
the API is still worth doing, but say in each finding that no page was checked. If the app role's password is
refused, another checkout's tests changed it — run the backend and the studio command below with
`DB_APP_PASSWORD=booking_app_test`.

**Staging:** the deployed stack. The studio command is the one in `e2e/src/studio.ts`'s header
comment (`ssh deploy@bpvps2 …`); the human must have that ssh access.

Make a throwaway studio — its own staff, members, a Credit Bundle and three classes:

```sh
npm --prefix be run -s e2e:studio -- setup        # local; staging: the ssh command + ` setup`
```

Read the one line starting `E2E_STUDIO=`; its JSON (the `E2eStudio` type in `be/src/e2e/studio.ts`)
is your studio. Keep its `slug` — teardown needs it. Tenancy probes need a **second** studio: run
`setup` again.

## 3. Browser and sign-in

Use Claude in Chrome when a browser is connected; otherwise Playwright CLI
(`npx -y @playwright/cli@latest`, run `--help` once), with a named session `-s=<role>` so parallel
runs never share cookies. Element refs expire with every snapshot and every dev-server reload: take
a fresh `snapshot` before each click, or script a longer flow with role and label locators in
`run-code --filename=<script>.js` and check that it did what it says (it can swallow its own errors).
Type passwords with `fill`: `run-code` echoes its code. End only your own session with `close`: `close-all` and `kill-all` end parallel runs too.

| Role | Where | Signing in |
|---|---|---|
| member | `urls.client` | Open the page, set localStorage `rt.client.session` to a member's `token`, reload. `buyer` holds no package; `canceller` and `arriver` hold the Credit Bundle. |
| instructor | `urls.portal` | `/login` with `staff.instructor.email` and `staff.password`. |
| admin | `urls.portal` | `/login` with `staff.admin.email` and `staff.password`. |
| super | `http://admin.portal.localhost:3001` (staging: `admin.portal.` + the portal's root domain) | A Platform administrator account (an address on `PLATFORM_ADMIN_EMAIL`). Take it from `QA_SUPER_EMAIL` / `QA_SUPER_PASSWORD`; when either is unset, ask the human for it and wait. |

On Stripe's hosted checkout page, stop and go back: paying is the buy-and-book journey's job, and a
local stack's Stripe key may be a real one.

## 4. Explore

Read your role's **charter** — [`member.md`](member.md), [`instructor.md`](instructor.md),
[`admin.md`](admin.md) or [`super.md`](super.md). It lists missions and the Inventory areas they
touch. Before a mission, skim that area's rows in `docs/md/test-scenarios.md`: they are the promises
you are checking, and each cites the spec that makes it.

Work each mission as a **session**: pursue the happy path once, then attack it —

- **boundaries:** zero, one, the maximum, one past it; empty, blank-only and very long text; past and
  far-future dates; the instant a window opens or closes.
- **repetition:** double-click submit, resubmit after success, back button then submit again, reload
  mid-flow, two tabs acting on the same thing.
- **state:** act on something just cancelled, archived, expired, full or deleted elsewhere.
- **roles and tenancy:** open another role's URL directly; with the second studio, open its slug
  while signed in to the first, and change ids in URLs to the other studio's.
- **honesty:** does every number, balance, status and message the page shows match what the API
  returned (`requests` / `response-body`) and what the Inventory row promises?

A mission is done when its happy path and every attack above have been tried or ruled out for that
screen. The charter is done when every mission is done.

A **finding** is behaviour that contradicts an Inventory row, a spec in `docs/md/`, or plain sense
(a crash, a raw error, data from another studio, a number that disagrees with itself). Before
reporting one:

1. Reproduce it once more from a fresh page.
2. Capture evidence: the URL, the steps, what the page said (snapshot text), console errors, and
   the failing request's method, path, status and response body. Screenshots stay in scratch; name
   their paths in the final report.
3. Search for a duplicate: `gh issue list --state all --search "<key words>"`. A duplicate gets a
   comment with your fresh evidence instead of a new issue.

Something the specs leave open is a **question**, not a finding — list it in the final report.

## 5. File each finding

```sh
gh issue create --label needs-triage --title "[QA:<role>] <what is wrong, in the glossary's words>" --body-file <scratch file>
```

Body:

```md
## What happens
<one or two sentences>

## Steps
1. …

## Expected
<what should happen, citing the Inventory ID or spec section>

## Evidence
<URL, request/response, console lines, snapshot excerpt>

## Risk
<money | tenancy | data-loss | UX> — <why>

## Proposed Inventory row
| <ID> | <AREA> | <role> | **Given** … **When** … **Then** … _(source)_ | <risk> | <level> |  | uncovered |

Found by exploratory QA (`/exploratory-qa <role> <stack>`), studio `<slug>`.
```

Use the terms in `be/CONTEXT.md`. The proposed ID is the next unused number in its area (read the
area's table); when a finding matches an existing row, name that row instead of proposing one.

## 6. Propose Inventory rows

Beyond the findings, propose a row for each promise you exercised that the Inventory lacks — a
behaviour the specs make that no row states. Follow `docs/md/testing.md` § Add a row: one testable
promise, **Given/When/Then**, the lowest `level` that can prove it, status `uncovered`. They go in
the final report only; a human adds them.

## 7. Close out

1. Tear the studio (or studios) down: `npm --prefix be run -s e2e:studio -- teardown <slug>`.
2. Close the browser session.
3. Re-run `git rev-parse HEAD; git status --porcelain` and compare with step 1. Undo a difference
   only when this run made it, and say so in the report; any other difference is reported and left
   alone — it is someone else's work.

Final report, in chat:

- **Issues filed** — number, title, risk (or "none found").
- **Duplicates commented on.**
- **Proposed Inventory rows** — the table rows, ready to paste.
- **Questions** — spec gaps a human should decide.
- **Not reached** — missions or attacks skipped, and why.
- **Repo untouched** — the before/after comparison.
