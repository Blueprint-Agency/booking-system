# Research: importing ClassPass bookings from the studio's email

**Question.** A studio sells some of its class spots on ClassPass. ClassPass has no integration with us, so a ClassPass member's booking never reaches ReserveToday: the class looks emptier than it is, and the member is not on the roster. Can we read the emails ClassPass sends the studio and book those members into our classes?

**Answer.** Yes. ClassPass emails the studio a separate message for each booking and each cancellation. Each one carries a stable reservation ID, the class name, its start time, the location and the member's name and email, which is enough to book and cancel without a person in the loop. The studio forwards those emails to an inbound address of ours. We do not need Gmail OAuth.

Source: one partner studio's inbox, read in October 2026 with the studio's permission. The samples below are redacted: member names and emails are placeholders, and the studio is `<Studio>`.

## The three emails that matter

All three come from `ClassPass <noreply@info.classpass.com>`, which also sends marketing ("You could be missing out on earnings", "Your week on ClassPass", partner surveys). Payouts come from `tipalti@classpass.com` and are out of scope.

### 1. `ClassPass user reservation` — a booking

One email per booking, sent within minutes.

```
New reservation received
A ClassPass member booked a spot at your business!
...
Reservation details
  Reservation        Yoga Stretch
  Date and time      Sep 18, 2026 @ 1:30 PM
  Location           <Studio>-<Location>
  Reservation ID     76ada2434e044c31b181fa605321a07f
Member information
  <Member Name>
  <member@example.com>
  Returning customer            ← or "New customer"
Schedule details
  ClassPass reservations   3 / 3     ← ClassPass's own allocation (SmartSpot)
  Total reservations       4 / 20
  ClassPass (3) Direct (1) Available (16)
  Data accurate at time of email send
```

### 2. `ClassPass reservation canceled by user` — a cancellation

```
The following ClassPass reservation has been cancelled by the user
Reservation key: 76ada2434e044c31b181fa605321a07f
Schedule details:
  Yoga Stretch
  at <Studio> - <Location>
  Sep 18, 2026 @ 1:30 PM
Cancelled by:
  Name: <Member Name>
  Email: <member@example.com>
```

The cancellation's **Reservation key is the booking's Reservation ID**. This was checked on two pairs in the sample. A cancellation therefore finds its booking by ID alone.

### 3. `ClassPass Daily Roster` — a recap, not an event

Sent about twice a day, once per ClassPass listing. It lists the upcoming classes, each with its time and the **members' names only**: no email and no reservation ID.

```
Your Roster Recap
<STUDIO> - <LOCATION>
Below are your ClassPass reservations for today, 09/17.*
  YOGA STRETCH
  01:30pm
  Fri, Sep 18
  <Member Name>
  <Member Name>
```

It cannot create or cancel bookings. It can only check that the bookings we imported match ClassPass's list of who is coming, and flag any member we hold but ClassPass doesn't, or the other way round.

## Every ClassPass email the studio received

About a year of mail, from June 2025 to October 2026, was surveyed by subject:

| Kind | Subjects | Matters to bookings |
|---|---|---|
| Booking | `ClassPass user reservation` | yes |
| Cancellation by the member | `ClassPass reservation canceled by user` | yes |
| Recap | `ClassPass Daily Roster` | only to check against |
| Mindbody-era notice | `Notice: Reservation Added as Unpaid to your Mindbody Venue` (Oct 2025) | no. ClassPass reached the studio through its Mindbody integration until the move |
| Payouts | `ClassPass Payment Issued` (from `tipalti@classpass.com`) | no |
| Marketing and product | `You could be missing out on earnings`, `Your week on ClassPass`, surveys, product updates | no |
| Support threads | from `partner-support@classpass.com` | no |

ClassPass sent **no** email for a late cancel, a no-show, a waitlist, an appointment or private session, or the business cancelling a booking or a class. Those events never reach us by email, so they stay manual: staff cancel a class on ClassPass themselves, and ClassPass tells its members.

**ClassPass has changed the booking email's layout before.** From November 2025 to January 2026 the booking email was plain text:

```
You received a ClassPass reservation
Reservation key: <32 hex>
Reservation details:
  Arm Balance
  at <Studio> - <Location>
  Dec 4, 2025 @ 6:30 PM
Reservation made by:
  Name: <Member Name>
  Email: <member@example.com>
```

From March 2026 it is the HTML layout shown below. The fields are the same; only the labels and their order moved. So the parser should look for each field by its label, and treat a ClassPass email it can't parse as something for staff to review, not as an error to throw away.

## What the sample shows

- **Authenticity.** The roster sample's headers show SPF, DKIM and DMARC all passing, and DKIM signed by `info.classpass.com`; it was sent through SendGrid. Forwarding usually leaves the DKIM signature intact and breaks SPF, so the inbound handler should accept only messages DKIM-signed by `info.classpass.com`, and should ignore SPF.
- **Times have no timezone.** `Sep 18, 2026 @ 1:30 PM` is the studio's local time, so it is read in the Tenant's timezone.
- **The location is written inconsistently.** The same studio appears as `<Studio>-<Location>`, `<Studio> - <Location>`, `<Studio>-` and `<Studio>` across emails. The studio has two ClassPass listings, and each gets its own roster. The location string has to be mapped, per Tenant, to one of our locations. That mapping should normalise spacing and punctuation, and an unknown string must go to review rather than be guessed.
- **Class names don't match exactly.** The booking email uses title case (`Warm Yoga`) and the roster uses capitals (`WARM YOGA`). Some ClassPass titles may not equal ours either. Match a booking to our class on location and start time first, then on a case-insensitive name. A match that isn't certain goes to review.
- **The same member can book and cancel within hours.** One booking was made at 11:06 and cancelled the same night, so a cancellation can arrive before staff ever look at the booking.
- **ClassPass caps its own share of spots.** "ClassPass reservations 3 / 3" is the allocation ClassPass's SmartSpot sets for itself. ClassPass also shows a "Direct" count and a total, but it has no live feed of our bookings. So the last spot can still be sold twice, though the cap makes it less likely.
- **Gmail threads these emails by subject.** That changes nothing for forwarding, because a filter forwards each message on its own.

## What it means for the design

- **ReserveToday is the source of truth; ClassPass is a sales channel.** After a migration, the classes are ordinary platform rows (`classes`, with `location_id` and `class_type_id`; see `docs/md/mindbody-import.md`). A ClassPass booking is attached to one of those classes, so the door works from one roster. The studio caps ClassPass's share of each class in the ClassPass dashboard, and copies schedule changes to ClassPass by hand until there is a real integration.
- **Nothing studio-specific is hardcoded.** A per-Tenant table maps each ClassPass location string to a `locations` row; the studio edits it in the portal. A booking is matched to a class by location plus start time, and then by a case-insensitive class name. Class names need no mapping table unless that last step turns out to be ambiguous.
- **No separate ClassPass schedule.** ClassPass bookings sit on the class roster, marked with their source. A small ClassPass page in the portal lists only what the importer couldn't place.

- **Transport.** The studio forwards to an inbound address with a random token; Resend receives it and calls our webhook (`email.received`). The Gmail filter can be `from:noreply@info.classpass.com`. The handler acts only on the two event subjects, keeps the roster for checking, and drops everything else, including marketing.
- **Idempotency.** Make `(tenant_id, classpass_reservation_id)` unique. A booking email that arrives twice books once, and a cancellation that arrives twice cancels once.
- **Payment.** Today every class booking is paid by one of the member's plans (`payAndBook`, `bookings.client_package_id`). A ClassPass booking was paid on ClassPass, so we need a new kind of booking that ClassPass paid for: it uses up no credits and counts as no revenue in our finance figures.
- **Members.** Find the member by email within the Tenant. If there isn't one, create a client record, but don't send them our sign-up or confirmation emails: ClassPass has already confirmed the booking with them.
- **Seats.** An imported booking takes a seat even when the class is full, and staff are told. ClassPass has already sold that spot, so refusing it would only hide the member from the door.
- **Review queue.** The portal lists anything the importer couldn't place: an unknown location, no class at that time, an ambiguous name, or a template it doesn't recognise. Every raw email is kept, so a fixed parser can re-run them.
- **Template drift.** Track parse failures per template, and alert when they rise.

## Open questions

- ~~Does the second listing (`<Studio>-` with nothing after the dash) mean a second premises?~~ Yes, very likely. ClassPass support's emails name a second premises listed as `<Studio> – <Location 2>`, written with an en dash, and no third listing appears anywhere. In its notification emails, though, that listing's name ends at the dash. So the strings in the emails can't be relied on to name a location, and the per-Tenant mapping is required, not optional.
- Does ClassPass send a late-cancel or no-show email to the studio? None turned up in about three months of mail.
- Does the studio get an email when it cancels a ClassPass booking itself, or when it cancels a class that ClassPass members were booked into?
