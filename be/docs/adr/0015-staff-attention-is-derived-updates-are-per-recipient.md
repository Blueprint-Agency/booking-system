# Staff attention is derived; updates are per recipient

**Status**: accepted (2026-10-27) — supersedes `docs/md/admin-restructure.md` §13 only in so far as
the portal now has a staff notification surface. The decision not to build a shared feed of
cancellations stands.

## Context

A studio's admins and instructors had no single place that said what was waiting on them. There
were three sidebar badges (each downloading its whole pending list to count it), four emails to every
admin, a banner on Finance, a review list on ClassPass, some log lines, and for a number of
situations nothing at all. Instructors were not told when someone else changed their work.

The admin Inbox was dropped on 2026-10-24 (#237): it would have been a shared feed of cancellations,
and a cancellation already shows on the session's roster and the member's profile. `inbox_items`
carried one shared read flag per row, so it could not say who had seen what.

Two different things were being asked for under one word:

- **Work waiting on a particular person.** A PT request to schedule, a leave request to decide, a
  refund that stopped part-way. It is true while the situation holds and false once someone fixes it.
- **News a particular person should hear.** "Your annual leave was approved." It happened once; it
  is read once.

## Decision

Keep them apart, and store only the second.

**An Attention item is derived.** Nothing holds the list. Each kind is a provider
(`services/attention/`) with a count, a list, an audience and whether it is dismissable, and an item
exists exactly while its predicate holds over the studio's live rows. It resolves by itself when
someone resolves the situation, so there is no read state to keep in step and no job that has to
notice. Its identity is `kind` + `subject_id`. The predicates are the ones the pages already use
(`listPtRequestsForAdmin`, the check-in, refund and ClassPass rules); a provider reuses them, it does
not restate them, so a badge and the page it points at cannot disagree.

**A Dismissal is a studio decision.** Only kinds where "do nothing" is a legitimate answer are
dismissable. An admin dismisses for everyone, it is audited with their name, and it is not undone.
(Added with the first dismissable kind.)

**An Update is an event, stored per recipient.** It is written in the same transaction as the act
that caused it, one row per recipient, with a snapshot payload, so each person has their own read
state and the text survives the subject changing or being deleted. It is never written for the staff
member who did the act. Updates older than 90 days are deleted. (Added with the first Update.)

**The bubble is the number of rows the person would see**: open Needs-action items plus unread
Updates. An aggregated line ("12 completed sessions have no instructor pay") counts once.

**`inbox_items` is not reused.** Its read flag is shared, and its four types are the cancellation
feed this decision does not revive. Dropping the table stays its own migration.

**One service, one seam.** The copy is composed in the backend, in the studio's timezone, so the
rules and the words live in one tested place. A new kind is one provider added to the registry
(`services/attention/registry.ts`): the summary, the panel, the groups and the sidebar badge keys
are all built from it.

**Polling, not push.** The portal reads a cheap summary on mount, every 60 s while the tab is
visible, on focus and on route change, and the full list when the panel opens. There is no
websocket or server-sent event.

## Consequences

- A permission switched off, a request cancelled or a leave decided is felt on the very next read,
  because nothing is cached or stored for derived items (ADR 0012 resolves permissions per request).
- Every provider's count runs on every poll of every open tab, so a count must be a handful of
  indexed rows. A kind that needs an expensive computation (the ClassPass roster difference) stays
  out until it can be made cheap.
- "Notification" in this codebase still means email (the email-template service). The staff surface
  is called **attention** in code and in the API: `/api/v1/portal/attention`.
- Updates add one tenant table (`staff_updates`) that the member permanent-deletion registry and the
  studio archive must know about; dismissals add `attention_dismissals`. Both land with the tickets
  that use them.
