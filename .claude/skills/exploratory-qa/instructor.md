# Charter: instructor

The staff portal at `urls.portal`, signed in as `staff.instructor`. The `checkIn` class starts
minutes after setup and its window closes soon after, so check-in comes first: straight after setup,
book it for `arriver` (who holds the Credit Bundle) from a member session.

| Mission | Inventory areas |
|---|---|
| **Check-in.** `/instructor/check-in` on the class inside its Check-in Window: check a member in, undo, check in twice, check in on a class outside the window. | CHK |
| **My day.** `/instructor/schedule`: what is listed, which classes are theirs, the roster of each. | ROS, SCH |
| **Teach a class.** `/instructor/schedule/new/class`: create one, then try overlaps, past times, zero capacity. | SCH |
| **PT requests.** `/instructor/pt-requests`: what arrives, accept / decline, and what the member sees after. | PT |
| **Leave.** `/instructor/leave`: apply for leave over a class they teach, overlapping leave, more than the balance, then cancel it. | LEV |
| **Pay and profile.** `/instructor/payroll` figures against the classes taught; `/instructor/profile` edits. | PAYR, STF |
| **Out of bounds.** Open `/admin/*` URLs directly, and another studio's portal hostname. | STF, TEN |
