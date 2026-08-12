# Backend

The domain. Every rule in the platform lives here — booking, credits, scheduling, payments, and instructor leave. The two frontends render what this context decides; they never decide anything themselves.

## Language

### Instructor leave

**Leave Request**:
An instructor's application to be absent for one or more dates, of one Leave Type.
_Avoid_: leave, absence, time off, holiday

**Leave Type**:
Annual or medical. The two are entirely separate — days never move between them.
_Avoid_: leave category, leave kind

**Leave Year**:
The calendar year a Leave Request counts against, fixed at submission from its first date. Recorded on the request so that changing a number later cannot rewrite a past year.
_Avoid_: leave period, entitlement year

**Assigned Days**:
The yearly figure set on an instructor's own profile — 14 by default, changeable per instructor. It is the input to next year's Pool, not the Pool itself.
_Avoid_: allowance, entitlement, quota, allocation

**Carried Days**:
Unused annual days moved into the following Leave Year, capped by a studio-wide limit. Annual leave carries; medical leave never does.
_Avoid_: rollover, accrual, carry-forward, banked days

**Pool**:
Assigned Days plus Carried Days, for one instructor, one Leave Type, one Leave Year. The number leave is drawn from, fixed for the year once the year begins. An admin can move it, but nothing else does.
_Avoid_: allowance, entitlement, grant, balance, budget

**Committed**:
Days on Leave Requests that are pending or approved. Both count — a pending request has already drawn down the Pool. There is deliberately no separate held or reserved state.
_Avoid_: held, reserved, on hold, provisional, soft-booked

**Taken**:
Days on approved Leave Requests only. What an instructor has actually used, as distinct from Committed.
_Avoid_: used, consumed

**Remaining**:
Pool minus Committed — what an instructor can still apply for. It can go negative when a Pool is lowered below what is already Committed, and it is shown negative rather than hidden.
_Avoid_: balance, available, left, unused

**Half Day**:
Morning or afternoon, costing 0.5 days, permitted only on a Leave Request covering a single date. The boundary is 13:00 Singapore time.
_Avoid_: partial day, AM/PM leave

**Occupying**:
The property that makes an instructor unschedulable on a date. Pending and approved Leave Requests both occupy; everything else does not. Leave occupies a person, never a room.
_Avoid_: blocking, unavailable, busy

### The four ways a Leave Request ends

Each belongs to exactly one actor and one starting status. They are not interchangeable.

**Withdraw**:
The instructor abandons their own request while it is still pending.
_Avoid_: cancel, delete, retract

**Cancel**:
The instructor gives back their own approved leave, before it starts.
_Avoid_: withdraw, revoke

**Reject**:
An admin refuses a pending request. A reason is mandatory and is emailed to the instructor.
_Avoid_: decline, deny, revoke

**Revoke**:
An admin takes back leave they already approved, before it starts. Once leave has started it is permanent — there is no path that un-approves lived days.
_Avoid_: unapprove, cancel, reject, reverse
