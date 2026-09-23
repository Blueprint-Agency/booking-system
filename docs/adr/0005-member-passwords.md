# Members sign in with email and password; the emailed code only proves an address

**Status**: accepted (2026-09-20). Records #173 (part of #171, "Member Passwords", stories M1–M13).
**Supersedes the member half of [ADR 0004](0004-self-hosted-auth-with-better-auth.md)** — the
`client` row of its pools table. The `staff` and `platform` pools are unchanged, and so is
everything else ADR 0004 decides: three pools, bearer sessions, the Session claim, no provisioning
on first request, Impersonation.

## Why

- **A code every time is a wait every time.** A member at the studio door waits on an inbox before
  they can see their booking.
- **Members arrive with no way to sign in.** A studio moving onto the platform brings its members
  with it (#171), and no password can be carried over from the system it leaves. They need a first
  sign-in that needs nothing from them but their email.
- **A password is what members expect**, and what their password managers already hold.

## The decision

### Email first, then the password or a link

The member sign-in form asks for the email alone. `POST /api/v1/public/members/sign-in-step`
answers one of two things:

- **`password`** — the address has a password credential in the `client` pool. The form asks for
  it and signs in at `/api/v1/auth/client/sign-in/email`.
- **`link_sent`** — anything else. A single-use set-password link (30 minutes) is mailed if the
  address belongs to a member of *this* studio who is not blocked, and nothing is mailed
  otherwise. The form shows "check your email" either way.

The answer tells a caller whether an address has a password, and so that an account exists at
this studio (per studio since [ADR 0006](0006-per-studio-logins.md)). That is the accepted cost of
an email-first form. It never tells them
whether the address is a member of the studio asking. The step has its own budget per address and
per email, because a `password` answer never reaches the pool's limiter.

An imported member, a member an admin added, and a member who joined by code before passwords all
have an account with no password credential, so each of them takes the link on their first
sign-in. The platform sends no invitations to members.

### The link is Better Auth's own reset, mailed by the studio

The `client` pool has `emailAndPassword` enabled with sign-up disabled, the same password hashing
as the staff pool, a minimum length of 8, and no composition rules. The link is Better Auth's
`/request-password-reset`, which creates the credential when there is none and replaces it when
there is. The pool's mail hook (`mailClientPasswordReset`) is what makes the link a studio's:

- it sends only to an address with a `clients` row at the Tenant in context, and not to a blocked
  one;
- it words the mail with that studio's `password_reset` template, under the studio's name.

The link lands on the member app's `/set-password`. From there,
`POST /api/v1/public/members/set-password` spends the token and signs the member in, all in one
step. The session gets the Tenant's Session claim like any other sign-in. The link is honoured
only at a studio where its owner is a member, and that is checked before the token is spent. A
link mailed under one studio's name cannot set a password on the way to a session at another
studio, and a blocked member is refused before their password changes. "Forgot password" (`/password-link`) and the admin's "Send set-password
link" on the member detail send the same link.

### The code proves an address at sign-up, and nothing else

Sign-up takes name, email, phone and password, then the existing 6-digit code.
`POST /public/members/register` checks the code, spends it, and writes four things together: the
auth user, its password, the studio's `clients` row and the session. So no account exists before
its email is proven. The code no longer signs anyone in: the pool's `/sign-in/email-otp` is
disabled, along with the email-OTP plugin's own password-reset and email-change endpoints.

~~Accounts stay one per email per pool, platform-wide. A member of two studios has one password.~~
**Superseded by [ADR 0006](0006-per-studio-logins.md):** a member of two studios has a login, and a
password, at each. Registering at a second studio leaves the first studio's password alone, and a
code or link from one studio is not found at another.

### Limits, audit, impersonation

- **Limits.** A link request or a password attempt spends a per-address budget (Better Auth's
  limiter, #114) and a per-email budget (`emailRateLimit`). Per email: 3 links per 15 minutes and
  10 attempts per 5 minutes. These budgets count across every studio, and anyone who knows a
  member's email can spend them. That can hold a member's password sign-in back for up to five
  minutes; the link still gets them in. We take that over leaving one member's password open to
  guesses spread across many addresses.
- **Timing.** A member's link is mailed during the request and a stranger's is not, so the two
  answers can take different times. The mail send is awaited on purpose: it runs inside the
  request's Tenant transaction (`sign-in-mail.ts`).
- **Audit.** A refused password is a `sign_in_failed` Auth event, exactly as for staff.
- **Impersonation.** It never needs the member's password, because it opens a session through the
  pool's adapter. Now that the pool has passwords, an impersonated session is refused
  `/change-password` (`impersonation_forbidden`). Without that refusal, an admin acting as a member
  could take the account over.
- **Email change by code stays off.** Enabling passwords brings in the email-OTP plugin's own
  email-change endpoints, which are disabled. A member's email is changed by an admin (#171), not
  by the member.

## Considered and rejected

- **Keeping the code as a sign-in alongside the password.** Two ways in means two things to rate
  limit and to explain. The link already covers "I have no password", and "forgot password" covers
  "I can't remember it".
- **Answering "no account here" at the email step.** A member-list oracle for any studio. The
  "check your email" screen is the same for a member and a stranger.
- **Mailing members an invitation at import.** The studio decides when members hear from the
  platform. A member's first sign-in sends them the link.
