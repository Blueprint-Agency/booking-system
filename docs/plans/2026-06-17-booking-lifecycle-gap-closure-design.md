# Booking Lifecycle Gap Closure Design

## Scope

Close the current lifecycle gaps across `be`, `fe-client`, and `fe-portal` for PT, class, workshop, and corporate bookings. The pass prioritizes session/credit correctness, cancellation status truth, and portal/client consistency.

## PT

- Keep PT request-driven: client submits a request, staff schedules it into a PT session.
- Show and enforce the real request cost: 1 session for 1-on-1, 2 sessions for 2-on-1.
- Return enough cancellation data for clients and portal to show `session_returned` versus `forfeited`.
- Add a staff backfill path for 2-on-1 partner requests where the partner was submitted as a non-member.
- Keep instructor permissions aligned with backend: instructors schedule pending requests and can only cancel their own scheduled sessions.

## Class

- Keep existing backend cancellation rules: client cancellation before policy window; admin cancellation always refunds.
- Wire the live portal class detail to existing class cancellation where missing.
- Keep class check-in/no-show behavior unchanged.

## Workshop

- Make admin workshop cancellation cascade to confirmed workshop bookings so client account state is not stale.
- Do not claim Stripe refunds unless an automated refund is actually issued.
- Reuse the same cancellation service from admin workshop and schedule routes.

## Corporate

- Keep corporate request flow canonical: client request -> portal schedule -> scheduled/attended/cancelled request status.
- Prevent direct corporate session cancellation from leaving linked requests scheduled against cancelled sessions.

## Jobs and Policy

- Register lifecycle jobs behind an explicit environment flag, so deployments can turn on PT expiry, PT completion, class no-show, and package expiry intentionally.
- Align frontend PT cancellation copy with backend seeded policy.
