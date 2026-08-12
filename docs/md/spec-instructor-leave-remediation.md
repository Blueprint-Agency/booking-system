# Spec — Instructor leave: review remediation

Follow-up to `spec-instructor-leave.md`, closing the findings from the two-axis code review of the leave implementation (Standards + Spec, 2026-08-10). Nothing here is new product behaviour except one communication gap the review exposed; the rest is correctness, convention and documentation debt created by the original eight tickets.

Status: ready for agent. Source: code review of the uncommitted leave feature, 2026-08-10.

## Problem Statement

The instructor leave feature works and typechecks, but it was built by eight agents in six waves and the review found the seams where that shows.

Three problems have teeth. **Leave emails can fail silently in production** — three new catch blocks flatten the error to a string and never report to Sentry, so an instructor whose leave was approved but never told, and an admin who never learned a class was cancelled, produce no alert anyone will see. **Two instructors submitting leave at the same moment can both be accepted** even when together they exceed the allowance, because the submission reads the existing rows and inserts without a transaction — the "pending counts against your balance" rule that exists precisely to prevent over-commitment has a hole in it. And **revoking approved leave erases who approved it**, overwriting the decision columns with the revoker's identity.

The rest is drift. The backend architecture doc still describes an object-storage upload flow the code no longer follows and calls the private bucket unused. Presentation helpers are copy-pasted byte-identical across three portal screens. Two functions independently query "all active admins" and loop an email send. Singapore-time arithmetic is hand-rolled in three places while the architecture doc names a home for it that has never been created. And the medical certificate's storage key is serialised to the calendar read while the approval queue deliberately withholds it — the same value, two different judgements about whether it should leave the server.

## Solution

Close the three correctness holes, align the code with what the repo's own documents say, and collapse the duplication the parallel build introduced.

From each person's side, almost nothing changes — that is the point. The exceptions:

- **An instructor whose approved leave is revoked is now told.** Today the leave silently disappears from their calendar and nobody emails them, which is the one way this feature can make someone turn up on a day they thought was theirs, or fail to turn up on a day that is.
- **An admin scheduling into a half-day absence gets a more precise picker.** When the screen already knows the class's start time, an instructor on morning leave is greyed only for morning classes instead of being labelled but freely selectable.

Everything else is invisible in the product and visible only to whoever maintains it next.

## User Stories

1. As an operator, I want a failed leave email to raise an alert, so that a silent notification failure is not discovered by an instructor turning up on the wrong day.
2. As an operator, I want the full error and its stack reported rather than a flattened message string, so that I can diagnose the failure without reproducing it.
3. As an operator, I want swallowed errors in the leave paths handled the same way as every other swallowed error in the backend, so that one convention covers the whole service.
4. As an instructor, I want two of my own requests submitted at the same moment to be evaluated against each other, so that I cannot accidentally commit more days than I have.
5. As an admin, I want the balance cap to hold under concurrency, so that "pending counts against your balance" means what it says.
6. As an admin, I want to see who originally approved a leave request even after it has been revoked, so that a reversal does not destroy the record of the original decision.
7. As an admin, I want the revoker recorded too, so that both halves of the story survive.
8. As an instructor, I want an email when my approved leave is revoked, so that I do not plan around time off that no longer exists.
9. As an instructor, I want that email to say who revoked it and when, so that I know who to ask.
10. As an admin scheduling a class with a known start time, I want an instructor on morning leave greyed out only for morning classes, so that the picker tells me the truth rather than a half-truth.
11. As an admin scheduling before a time is chosen, I want a half-day absence labelled rather than blocked, so that the picker never refuses something the server would accept.
12. As a developer, I want the architecture document to describe the object-storage upload flow the code actually implements, so that the canonical spine is not lying to the next reader.
13. As a developer, I want the private bucket documented as in use rather than reserved, so that nobody plans a feature around it being free.
14. As a developer, I want one place that renders a leave status, type and date range, so that changing a label does not mean finding three copies.
15. As a developer, I want one function that emails every active admin, so that the recipient rule is not defined twice.
16. As a developer, I want Singapore-time arithmetic in the module the architecture document already names for it, so that the fourth person who needs it does not hand-roll a fourth copy.
17. As a developer, I want the maximum certificate size expressed once, so that the limit enforced and the limit announced cannot drift apart.
18. As a developer, I want the caller's identity assembled once into the viewer type that already exists, so that three routes stop rebuilding the same pair of fields.
19. As a developer, I want the leave year default computed in the service rather than the route, so that routes stay free of domain logic as the conventions require.
20. As a security reviewer, I want the certificate storage key withheld from every read path, so that the value is consistently server-only rather than exposed on one endpoint and withheld on another.
21. As a developer, I want the ticket and spec wording for the allowance screen corrected to match the superadmin-only policy surface, so that the next reader does not treat a deliberate gate as a bug.
22. As a developer, I want the known remaining calendar duplication recorded explicitly, so that it is a decision rather than an oversight.
23. As an agent working in this repo, I want the leave documentation to agree with the leave code, so that I do not implement from a stale description.

## Implementation Decisions

### Error reporting in the leave paths (hard finding)

- The three swallowed catches — two in the leave service's notification helpers, one in the class-cancellation service's admin notification — adopt the backend's existing convention: log the error object itself, not a flattened string, and report it to the error monitor alongside.
- The swallowing itself stays. A decision that has been recorded must not be undone by a mail transport fault; that judgement was correct. Only the silence is wrong.
- Because the same pattern now appears in several places, the log-and-report pair is written once and called from each site rather than repeated.

### Concurrent submission (hard finding)

- Leave submission moves inside a single transaction that covers the balance read, the clash check and the insert.
- Concurrency is serialised **per instructor** by taking a row lock on that instructor's own record at the start of the transaction. Two requests from the same instructor queue behind each other; requests from different instructors do not contend, because their balances are independent.
- A row lock on the instructor is used rather than a lock over the leave rows, because the rows being guarded against are the ones that do not exist yet — an absent row cannot be locked, so the parent record is the correct serialisation point.
- No change to the balance rule itself. The pure arithmetic is already correct; only its isolation was missing.

### Revocation preserves the approval (hard finding)

- Revoking approved leave no longer overwrites the decision columns. The approver and the approval timestamp stay as they are.
- The revoker's identity is recorded in the audit log, which already receives every leave transition. No new columns and therefore no migration: the audit log is the correct home for "who did what to this row", and duplicating it into the row buys nothing.
- The decision reason column continues to carry the rejection reason only. A revocation reason, if it is ever wanted, is a separate decision.

### Revocation tells the instructor (the one behaviour addition)

- Revoking approved leave now emails the instructor, following the same template-and-send path as approval and rejection.
- This goes beyond the original spec, which named approval and rejection only. It is included because silent revocation is the single way this feature can cause someone to be absent when they are expected, or present when they are not — the failure the whole feature exists to prevent.
- The email names the dates and the fact that the leave no longer stands. Like the other two, it is sent after the write commits and cannot fail the transition.

### Half-day precision in the instructor picker

- Where a scheduling screen already knows the intended start time, the picker compares it against the leave half and disables an instructor who is genuinely unavailable for that slot.
- Where only a date is known, the current behaviour stands: the instructor is labelled with the half and remains selectable.
- The comparison reuses the existing pure half-day boundary rule rather than re-deriving 13:00 anywhere in the portal. If that means exposing the boundary decision through a small pure helper, it is added to the existing rules module.
- The server refusal remains authoritative in both cases. The picker is still a hint.

### Certificate key never leaves the server

- The calendar read stops serialising the certificate storage key and reports only whether a certificate exists, matching what the approval queue already does.
- Retrieval continues to go through the signed-URL endpoint, which performs its own ownership check.

### Documentation alignment

- The backend architecture document's object-storage section is corrected to describe the implemented flow: the API receives the file, validates type and size server-side, and writes to storage; retrieval is a short-lived signed GET. The private bucket is documented as in use for medical certificates, not reserved.
- **This resolves a contradiction, and the resolution is a real decision, not a formality.** The documented presigned-PUT flow was written for public imagery. Medical certificates are validated at a trust boundary the server controls and land in a private bucket, and server-side upload avoids configuring cross-origin access on a bucket holding health documents. The implemented flow is kept and the document is corrected to match. Public imagery uploads, if they are ever built, may still use the presigned flow — the document should say which applies where rather than describing one flow for everything.
- The leave spec and ticket 02's acceptance criterion are corrected to say the allowances are set by a superadmin. The policy surface is superadmin-only by existing design across every other setting on it; carving out an exception for two integers would make these the odd ones out. The code is right and the wording was wrong.
  - **Superseded (2026-08-12), and worth reading in that order.** The correction above was right about the code as it then stood: two studio-wide allowance integers on the superadmin-only policy screen, and a ticket that described them as an admin's to set. Both integers have since gone. The yearly figure is now **Assigned Days**, held per instructor and set on the staff profile by an **admin or superadmin** — so the person who approves the leave is now also the person who sets the number, which is the thing the earlier correction ruled out. What survived is the reasoning, not the conclusion: the policy screen is still superadmin-only across every setting on it, and the one leave field left there — the studio-wide carry-over cap — is superadmin-only for exactly the reason given above. See `spec-instructor-leave-pools.md` and `be/docs/adr/0001-per-instructor-leave-pools-with-carry-over.md`.

### Duplication

- The portal's leave presentation helpers — the error-message mapping, the day and date-range formatting, and the status, type and half-day labels — move into one module that the instructor page, the admin page and the leave calendar all import.
- The two "email every active admin" implementations collapse into one function taking a template and its variables.
- Singapore-time arithmetic moves into the shared time module the architecture document already names, and the existing hand-rolled copies are pointed at it. This is the only change in this spec that touches a file outside the leave feature, and it is limited to replacing duplicated arithmetic with a call.
- The maximum certificate size is declared once and referenced by both the request body limit and the validation rule, so the enforced limit and the announced limit cannot diverge.
- The caller's identity is assembled into the existing viewer type at one place rather than rebuilt at three route sites.

### Explicitly not changed

- The widened select component that accepts either a list of options or children is left alone. Both forms have real callers, so it is a widened interface rather than speculative generality.
- The branching on cancellation source inside the class-cancellation service is left alone. Four short branches in one function are clearer than a lookup table that would have to be read alongside them.

## Testing Decisions

- **What a good test is here:** it states a rule in the language of the person affected and survives a refactor of how the rule is implemented. "A morning-leave instructor is unavailable for a 09:00 class and available for a 15:00 one" is a test. "The picker calls the boundary helper" is not.
- **One seam, and it already exists.** Everything decidable without a database goes into the existing pure leave rules module and its colocated checks, run by the backend's existing check script. No new seam is introduced and no test framework is added.
- **What gets checked:** the half-day slot comparison — a start time before the boundary, after it, exactly on it, and the straddling case already covered extended to the picker's question. Any pure helper extracted for the portal's benefit is checked here rather than in the portal.
- **What is deliberately not unit-checked, consistent with the original spec:** the transaction and its row lock, the error reporting, the email sends, and the read-path serialisation. These are verified by typecheck, by structure, and by exercising the flows in a running app.
- **The concurrency fix needs a deliberate manual check**, because it is the one change whose failure mode is invisible to every automated check in this repo: with the database running, fire two submissions for the same instructor simultaneously where each alone fits the balance but together they exceed it, and confirm exactly one is accepted. This is the single most important verification in this spec.
- Regression to demonstrate by hand: approve a leave request as one admin, revoke it as another, and confirm the original approver is still recorded and the instructor received an email.

## Out of Scope

- **Folding the admin schedule page's month grid into the shared calendar component.** The review correctly noted two hand-rolled month grids still exist. That page's month view is entangled with its day and week views and its own event model on a very large file; no defect is traced to the duplication. Recorded as known, deliberately deferred.
- Reverting the payroll calendar refactor. It was unrequested scope, but it is done, it builds, and undoing it is more churn than leaving it. It needs a visual check, not a rewrite.
- Adding a revocation reason field.
- Any change to the balance rule, the backdating rule, the clash rule, or the redaction model — all four were verified correct by the review.
- Bringing workshop write paths into the occupancy module. Still out of scope, still recorded in the original spec.
- Introducing a test framework, an integration-test database, or portal-side unit tests.
- Applying migrations or seeding the database. Operational, not a code change.

## Further Notes

- The three hard findings share a cause worth naming: each is a place where a single agent, working correctly within its own ticket, could not see a cross-cutting convention. The error-reporting convention lives in a document none of the eight tickets pointed at; the concurrency hole spans the submit path and the balance rule, which were the same ticket but different functions; the revocation overwrite was invisible without asking what the columns meant to a *previous* writer. Wave-based parallel implementation buys speed and pays for it in exactly this coin.
- The certificate-key inconsistency is the mildest finding and the most instructive: two agents made opposite calls about the same value because the spec said "admin-only" about the field in one place and "never the key" in another. Neither was wrong; the spec was.
- The concurrency fix is the only change here that could plausibly introduce a new problem — a lock taken in the wrong place, or held across a slow call, becomes a contention bug that will not show up under single-user testing. Keep the transaction narrow and take the lock first.
- Nothing in this spec requires a migration. If an implementer concludes one is needed, that is a signal the approach has drifted and is worth stopping over.
