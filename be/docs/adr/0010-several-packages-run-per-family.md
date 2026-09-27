# Several packages run per Family; the member picks the payer

**Status**: accepted (2026-09-27) — supersedes the "one runs per Family" half of `0004-every-package-activates-on-first-booking.md`: the section **One Activated package per Family**, the member's one lever being `use_credits`, **The strict reading, and what it costs**, and the return-to-Dormant branch of **Ended, and the sweep**. The rest of 0004 stands: every purchase lands Dormant, the first booking a package pays for Activates it and stamps its end date from that day, `validity_days` is frozen onto the purchase, and the booking paths sweep the member's own expired rows first. It also supersedes the Unlimited purchase caps in `docs/md/spec-pre-launch-batch.md` §6 ("one Activated plan plus at most one Dormant", and "a renewal only at the live plan's Home Location"). Issue #322, parent #321.

ADR 0004 let one package per Family run at a time. While a package ran it was the only one in its Family that could pay, whatever the member asked, and the packages bought after it waited Dormant behind it. It was a deliberate reading, taken to keep "which of two live packages pays" out of the booking path.

It turned out to describe a studio the members never had. They came from Mindbody, where several packages ran side by side and the member or staff picked which one paid. On the 25 Sep 2026 export, **18 of 288 members held two or more running class packages that day** — 15 held two Unlimited Plans, mostly a renewal bought and started early, and 3 an Unlimited Plan beside Credit Bundles. Over 2023–2026, **51 members switched A → B → A between two paid options within 14 days**, once free classes, comps and workshop tickets are excluded. Under the one-at-a-time rule every one of them loses a choice they used to have, and a member whose running package cannot pay for a class — a plan that does not Cover the Location, a bundle one credit short — cannot book it at all, because nothing waiting behind it may step in. The package rules planned next (#321: a class may accept only some packages) would make that dead end common.

## Decision

**Any number of class packages, and any number of PT packages, may be Activated at once.** The class family is still Credit Bundle + Unlimited Plan + Trial and the PT family still PT packages alone; a Family still says what kind of booking Activates a package. It no longer limits how many run. Migration `0093_several_packages_run_per_family.sql` drops the two partial unique indexes (`client_packages_one_activated_class_per_client`, `client_packages_one_activated_pt_per_client`). It drops rather than adds, which the migrations README's rule 0 allows only for what no running build reads: no query reads an index, and a rolled-back build runs safely without them (its selection takes the earliest-ending of two running packages). It changes no row: every Dormant package stays Dormant, every running one keeps its date.

**A purchase still lands Dormant and still Activates on the first booking it pays for.** What changes is that the booking may be one the member makes while another package runs: picking a Dormant package starts its clock there and then, one Duration or `validity_days` from the booking moment, and the Book sheet says the end date it will get before they confirm. The Trial stays one per member, ever.

**The member picks the payer.** Selection (`services/packages/selection.ts`) is two steps:

1. **Classify** every live class package of the member against the class: **Eligible**, or the first reason it is not — `location_not_covered` (an Unlimited Plan that does not Cover the class's Location), `plan_expires_before_class` (a running package whose expiry is before the class starts, or a Dormant one whose `now + its length` is), `insufficient_credits` (a credit kind holding less than the class's credit cost).
2. **Choose**: the package the member named, if it is Eligible — refused with that package's own reason if not, and `404 client_package_not_found` if it is not one of the member's live class packages. With nothing named, the **Default payer**: the first Eligible package in default order — running packages soonest-ending first, then Dormant ones with Unlimited Plans before credit kinds, each in purchase order. Nothing Eligible refuses with the reason of the first package in default order; a member holding nothing is `insufficient_credits`.

The default order is the one a member would choose for themselves nine times in ten: spend the clock that is about to run out, never start a new clock they did not ask for, keep credits for the classes a plan cannot pay for.

**`use_credits` is gone.** `POST /me/bookings/class` takes `{ class_id, client_package_id? }` and is strict, so a client still sending `use_credits` gets a `400` rather than a booking paid in a way it did not ask for. The response names the package that paid (`paid_with: { client_package_id, name, kind }`). `GET /me/classes/:id` returns the class with the member's class packages classified, in default order, and `default_client_package_id` — what the Book sheet lists and pre-selects.

**Where nobody is there to pick, the Default payer pays**, through the same function: automatic waitlist Promotion, staff booking a member, staff promoting from the waitlist, the waitlist join's "could they pay?" check, the waitlist panel's "would pay with", and an old client sending no package. Staff booking and promote responses carry `paid_with` so staff know what was spent. A member nothing can pay for is skipped or refused exactly as before.

**The Unlimited purchase caps go.** No "at most one Activated plus one Dormant plan", no "a renewal only at the live plan's Home Location" — `unlimited_limit_reached` and `unlimited_renewal_location_mismatch` are retired. A member may hold plans homed at different Locations. The Cross-Location Add-On is unchanged: one per plan, still the way to make one plan Cover every Location.

## What else goes

- **`family_already_activated`.** Staff may give a Dormant package an expiry while another of its Family runs; it is an Activation by hand and both then run.
- **`pt_package_not_current`.** A PT session request against a Dormant PT package is no longer refused because another PT package runs; it Activates the one the member chose. The rest of the PT request stands — the member still names the package. *(Since `0011-pt-activates-on-scheduling.md` the request debits the chosen package and leaves it Dormant; scheduling the session Activates it.)*
- **The revival-to-Dormant branch** (`revivalPatch` in 0004). Credits returned to a spent package — a cancelled class, an admin top-up — land back on it with its expiry untouched. It is simply running again, beside whatever else runs. 0004 sent it back to Dormant only because two Activated in one Family was forbidden.

## Considered

- **Keep one per Family and add an "override" for staff.** Rejected: it leaves the member's own dead end in place, and it is exactly the case the Mindbody export says is ordinary rather than exceptional.
- **Let the server always choose, with no member input.** Rejected: 51 members switching between two options within a fortnight is a choice being made, and the server cannot see why. The Default payer covers the one-tap case; the picker covers the rest.
- **Keep `use_credits` as an alias for "pick a credit kind".** Rejected: a flag that means "some bundle, you choose which" is the silent spend 0004 was worried about. Naming the package is the whole point, and a hard `400` is the honest answer to a client that has not caught up.

## Consequences

- "The running package" is no longer a thing to look up. Every rule that used to defer to it — booking, promotion, the waitlist, PT requests, the admin expiry edit — reads each package on its own. `class_family_running` / `pt_family_running` on the entitlements now mean "any is running", and the entitlements gain `unlimited_plans: [{ id, location, covers_both, running }]` so the schedule can ask whether any plan Covers a row.
- A member can now start a second clock by picking a Dormant package while another runs. That is a choice made on a sheet that states the end date it will get; it is never made for them — the Default payer takes a running package before a Dormant one.
- The member app's "use N credits" nudge on a class outside the plan's coverage is reduced to the Add-On link; picking credits is the Book sheet's job now. The Account page lists every running package, and the waitlist copy no longer tells a member to "try again once it has ended".
- The two unique indexes were the backstop for a race 0004 worried about. With several allowed to run there is nothing for them to catch; Activation itself stays single-writer (`PKG-18`), stamped inside the booking transaction that holds the package rows locked.

## Left open

- **An Activation deadline**, as in 0004.
- **Package rules per class** (#321, next PR): a class accepting only some packages adds a fourth reason, `not_accepted`, to the classify step. This ADR's choose step does not change for it.
- **The Mindbody transform** mapped holdings the 0004 way ("the one ending soonest runs, the others wait") until #324, which settled it: every holding Mindbody had started arrives Activated with its own expiry, one not yet started arrives Dormant, and a future booking is paid by the soonest-ending running package that Covers the class and lasts until it (the migration runbook's decision 13).
