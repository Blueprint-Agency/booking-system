import test from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS } from "./nav-items";
import { visibleToRole } from "@/lib/staff-role";

// The Inbox and Notifications screens read fixture data that made untrue
// claims about refunds and about which emails are sent (#277). They are hidden
// until they can be wired to the backend, so staff must have no way to reach them.
test("the sidebar offers no Inbox or Notifications screen", () => {
  const hrefs = NAV_ITEMS.map((item) => item.href);
  assert.ok(!hrefs.includes("/admin/inbox"), "Inbox is still in the nav");
  assert.ok(!hrefs.includes("/admin/notifications"), "Notifications is still in the nav");
});

// Every Receipt in the studio is the studio's money, for its admins (#389).
test("INV-54 the sidebar offers Receipts under Finance to an admin, and never to an instructor", () => {
  const receipts = NAV_ITEMS.find((item) => item.href === "/admin/receipts");
  assert.ok(receipts, "Receipts is in the nav");
  assert.equal(receipts.label, "Receipts");
  assert.equal(receipts.group, "Finance");
  assert.equal(visibleToRole(receipts, "admin"), true);
  assert.equal(visibleToRole(receipts, "instructor"), false);
});

test("NTF-46 the sidebar offers Emails under Settings to an admin, and never to an instructor", () => {
  const emails = NAV_ITEMS.find((item) => item.href === "/admin/emails");
  assert.ok(emails, "Emails is in the nav");
  assert.equal(emails.label, "Emails");
  assert.equal(emails.group, "Settings");
  assert.equal(visibleToRole(emails, "admin"), true);
  assert.equal(visibleToRole(emails, "instructor"), false);
});

// The ClassPass page holds the studio's private forwarding address (#409).
test("CPS-19 the sidebar offers ClassPass under Settings to an admin, and never to an instructor", () => {
  const classpass = NAV_ITEMS.find((item) => item.href === "/admin/classpass");
  assert.ok(classpass, "ClassPass is in the nav");
  assert.equal(classpass.label, "ClassPass");
  assert.equal(classpass.group, "Settings");
  assert.equal(visibleToRole(classpass, "admin"), true);
  assert.equal(visibleToRole(classpass, "instructor"), false);
});
