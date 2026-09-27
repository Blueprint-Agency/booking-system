# A PT package Activates when its first session is scheduled, and its first cancel can undo it

**Status**: accepted (2026-09-27) — supersedes, for PT packages only, two sentences of `0004-every-package-activates-on-first-booking.md`: "for PT it is the session request that debits the first session" (**What changed**, first paragraph), and the rule that Activation never reverses on its own (the glossary's **Activation** entry, which 0004 and 0010 both left standing). Everything else in 0004 and 0010 stands, and nothing about the class family changes. Issue #332, parent #326.

Under 0004 a PT package Activated when the member submitted a session request: the request debited the first session, and the package's clock started there and then. A request is not a session, though. It sits pending while the studio and the member agree a time on WhatsApp, and it may never become one: it can be cancelled, or lapse after the book-in-advance days. Meanwhile the package's validity was running. A member who asked for a session a fortnight before the studio could fit them in had lost a fortnight; one whose request lapsed had lost it for nothing.

The studio's view is that a PT package is used when a session is **on the calendar**, not when one is asked for. Both rule changes below follow from that one decision, which is why they are recorded together.

## Decision

**A PT package Activates when its first session is scheduled.** Submitting a request still debits the session(s) from the package the member picked, exactly as before — the balance is how two requests are kept from spending one session — but a Dormant package stays Dormant. Staff scheduling the request, from the admin or the instructor route, is the Activation: the end date is `validity_days` from **the scheduling moment** (not the session's date, for the same reason 0004 counts from the booking moment and not the class date), stamped inside the scheduling transaction with the package row locked. A request scheduled against a package that is already running leaves its date alone. A pending request cancelled by anyone, or expired by the job, returns its debit to a package that is still Dormant and leaves it so.

**The package records which session Activated it** — `client_packages.activated_by_pt_session_id`, migration `0095`. Null on every class-family row, on every Dormant row, and on every PT package Activated before this decision. It carries **no foreign key**: a session already reaches the package through its request, so a key back would close a cycle, and the studio archive and delete order (`services/tenants/transfer-order.ts`) breaks a cycle by deferring every nullable reference left in it — which took in `bookings` and made deleting a real-sized studio null every booking before deleting it. The pointer is only ever compared with the id of the session being cancelled, so one left dangling matches nothing.

**Cancelling that session in time returns the package to Dormant.** When the Activating session is cancelled and the cancel is not **late**, the package's expiry and its Activating session are cleared inside the cancel transaction, and a zero-delta `manual_adjustments` row with reason `pt_activation_reversed` records it, attributed to the staff member who cancelled (none for a member). The balance is the cancel's business, not this rule's: whatever the cancel returned stays returned, and a session kept rather than returned stays kept. The next session scheduled on the package Activates it afresh, from that moment.

- **Late** is a cancel inside the PT cancellation window, by any actor. A member cannot make one — their cancel inside the window is refused (`cancellation_window_passed`) — so in practice only a staff cancel inside the window leaves the package Activated. A staff cancel's refund is still staff's choice and never the window's; the window now decides only this, and is recorded truthfully on the cancellations row of a whole-request staff cancel as it already was on a single-booking one (#320).
- **Only the Activating session.** Cancelling any later session on the package never touches its expiry. Neither does cancelling the Activating session once the package is no longer its to undo — after it already went back to Dormant once, or after staff set the expiry by hand, which clears the pointer: a date staff chose is not a session's to take away.
- **Both cancel paths.** The whole-request cancel (member, admin, instructor) and the single-booking cancel of the paying seat (member `DELETE /me/bookings/:id`, staff `…/bookings/:id/cancel`) apply the same rule. A booking on a Voided package (a Refund's cancels) never reverses: that package has ended.
- **Class packages are untouched.** A class-family Activation is still one-way; staff return a plan to Dormant by hand.

## Considered

- **Activate at submit, as 0004 did, and refund the lost days on a cancelled request.** Rejected: "days owed" is a second clock to keep, and it still charges validity for a request that sat pending.
- **Activate at the session's start time.** Rejected: it lets a member book a session far ahead to push their start date out, the free extension 0004 already refused for classes by counting from the booking moment.
- **Reverse on any session's cancel while nothing else has been attended.** Rejected: which session "counts" then depends on what happened to all of them, and a package with two scheduled sessions could flip Dormant and back as each is moved. One pointer to one session is a rule a person can check by looking.

## Consequences

- A member's PT package can be debited and Dormant at once — a pending request against a package nobody has scheduled yet. The account page shows it with its sessions left and no end date, as it shows any Dormant package.
- If the Activating session is cancelled in time while a later session on the same package is still scheduled, the package goes back to Dormant with that later session on it, and stays Dormant until the next session is scheduled. Scheduling is the event; a session already on the calendar does not re-Activate it.
- The portal's manual PT session, when it lands (#326), is scheduling too: it Activates each package it debits that is still Dormant through the same step, and records itself as the Activating session.
