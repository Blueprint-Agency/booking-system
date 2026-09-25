import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS } from "./nav-items";

// The Inbox and Notifications screens read fixture data that made untrue
// claims about refunds and about which emails are sent (#277). They are hidden
// until they can be wired to the backend, so staff must have no way to reach them.
test("the sidebar offers no Inbox or Notifications screen", () => {
  const hrefs = NAV_ITEMS.map((item) => item.href);
  assert.ok(!hrefs.includes("/admin/inbox"), "Inbox is still in the nav");
  assert.ok(!hrefs.includes("/admin/notifications"), "Notifications is still in the nav");
});
