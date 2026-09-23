# Charter: super

The super portal (`/platform` on the `admin.portal.` host), signed in as a Platform administrator.
It creates, lists and suspends studios. On **staging**, studios it creates are real rows that no
teardown removes: create nothing there, and suspend only your own `e2e-` studio.

| Mission | Inventory areas |
|---|---|
| **Sign-in.** Wrong password, an address that is not a Platform administrator, a studio Admin's credentials, sign out and the back button. | SUP, AUTH |
| **Create a studio** (local only). Slug rules — taken, reserved `e2e-`, uppercase, too long, blank — then invite its first Admin and see the invitation listed. The local stack delivers no mail, so the invitation itself cannot be followed. | SUP, STF |
| **List and suspend.** Suspend your `e2e-` studio; what its members and staff now see; reopen it. | SUP |
| **Reach.** With the Platform administrator session, open a studio's portal and member app, and call a studio admin route; they run the platform, not the studio. | SUP, TEN |
