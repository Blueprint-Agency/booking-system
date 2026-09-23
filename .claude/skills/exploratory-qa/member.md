# Charter: member

The member app at `urls.client`. Sign in as `canceller` (holds the Credit Bundle) for most missions
and as `buyer` (holds no package) where a mission says so. Anonymous missions come first, before
setting the token. The studio has no workshops, no PT packages and three members: sign in to the
portal as `staff.admin` to create what a mission needs, or list the mission under Not reached.

| Mission | Inventory areas |
|---|---|
| **Browse signed out.** Home (the class schedule), `/packages`, `/workshops`, `/merch`, `/private-sessions`: what a visitor sees, where each Book / Buy sends them, and back again after sign-in. | CAT, AUTH |
| **Book and unbook.** As `canceller`: book a class, see it in `/account/classes`, cancel it, book it again. Watch the credit balance at every step. | BKG, CXL, CRD |
| **No package.** As `buyer`: try to book, follow the prompt to buy, and stop at Stripe's page. | BKG, PKG, PAY |
| **Waitlist and full classes.** Find or reason about a full class; join and leave a waitlist. | WTL |
| **Private sessions and workshops.** Request a PT session; open a workshop and its booking path. | PT, WSP |
| **My account.** Profile edits (names, phone, password change), `/account/*` pages, what they list and whether it agrees with bookings you just made. | ACC |
| **Other studio.** With a second studio: open its hostname with this member's token, and put its class ids into this studio's URLs. | TEN |
