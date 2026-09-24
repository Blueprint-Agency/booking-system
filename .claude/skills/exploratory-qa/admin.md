# Charter: admin

The staff portal at `urls.portal`, signed in as `staff.admin`. The admin section is wide; take the
missions in order — they follow the risk order money → tenancy → data loss → UX.

| Mission | Inventory areas |
|---|---|
| **Customers and credits.** `/admin/customers` and a member's profile: adjust credits (blank reason, negative, huge), block and unblock, send a set-password link. | CUS, CRD, AUTH |
| **Purchases and refunds.** `/admin/purchases`, `/admin/finance`: refund a purchase partly, fully, twice; do the totals agree with each other? | RFD, FIN, PAY |
| **Catalogue.** Packages, promo codes (expired, zero, 100 %, reused), merch, workshops — create, edit, archive, and check the member app shows the change. | PKG, PRM, MRC, WSP |
| **Schedule a day.** `/admin/schedule`: a class, a series, a workshop; edit and cancel one with bookings on it; rooms and capacity limits. | SCH, CXL |
| **Run a day.** `/admin/check-in` and a class's roster; mark attendance. | CHK, ROS |
| **Policy and people.** `/admin/policy` (cancellation window), `/admin/staff`, `/admin/leave`, `/admin/locations`, `/admin/rooms`, `/admin/waiver`, `/admin/notifications`. | CXL, STF, LEV, LOC, WVR, NTF |
| **Other studio.** With a second studio: its customer, class and purchase ids in this studio's URLs; its portal hostname with this session. | TEN |
