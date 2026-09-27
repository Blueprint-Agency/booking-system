import test from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTOR_PERMISSIONS, knownPermissions, mayDo } from "@/lib/instructor-permissions";
import { INSTRUCTOR_NAV_ITEMS, instructorNavItems } from "./instructor-nav-items";

// Beside the nav items test: every button and nav item a switch governs is
// decided by `mayDo`, so this is the rule the portal's visibility rests on.

test("STF-34 an admin may do everything, whatever the array holds", () => {
  for (const key of INSTRUCTOR_PERMISSIONS) {
    assert.equal(mayDo({ role: "admin", permissions: [] }, key), true);
  }
});

test("STF-34 an instructor may do only what their permissions hold", () => {
  const staff = { role: "instructor" as const, permissions: ["take_pt_bookings"] };
  assert.equal(mayDo(staff, "take_pt_bookings"), true);
  assert.equal(mayDo(staff, "schedule_classes"), false);
  assert.equal(mayDo(staff, "manage_rosters"), false);
});

test("STF-34 an instructor holding every permission may do everything", () => {
  const staff = { role: "instructor" as const, permissions: [...INSTRUCTOR_PERMISSIONS] };
  for (const key of INSTRUCTOR_PERMISSIONS) assert.equal(mayDo(staff, key), true);
});

test("STF-34 with no staff member yet, nothing is allowed", () => {
  assert.equal(mayDo(null, "schedule_classes"), false);
  assert.equal(mayDo(undefined, "schedule_classes"), false);
});

test("STF-34 unknown keys grant nothing and are dropped", () => {
  const staff = { role: "instructor" as const, permissions: ["run_payroll"] };
  for (const key of INSTRUCTOR_PERMISSIONS) assert.equal(mayDo(staff, key), false);
  assert.deepEqual(knownPermissions(["run_payroll", "manage_rosters", 7, "schedule_classes"]), [
    "schedule_classes",
    "manage_rosters",
  ]);
  assert.deepEqual(knownPermissions(null), []);
});

const navFor = (staff: Parameters<typeof mayDo>[0]) =>
  instructorNavItems((key) => mayDo(staff, key)).map((item) => item.href);

test("STF-38 an instructor without Take PT bookings has no PT Requests in their nav; everything they teach with stays", () => {
  const hrefs = navFor({ role: "instructor", permissions: ["schedule_classes", "manage_rosters"] });
  assert.ok(!hrefs.includes("/instructor/pt-requests"));
  assert.deepEqual(
    hrefs,
    INSTRUCTOR_NAV_ITEMS.map((item) => item.href).filter((href) => href !== "/instructor/pt-requests")
  );
});

test("STF-38 PT Requests is in the nav of an instructor with Take PT bookings, and of an admin whatever the array holds", () => {
  assert.ok(navFor({ role: "instructor", permissions: ["take_pt_bookings"] }).includes("/instructor/pt-requests"));
  assert.ok(navFor({ role: "admin", permissions: [] }).includes("/instructor/pt-requests"));
});

test("STF-38 an unknown key does not bring PT Requests back", () => {
  assert.ok(!navFor({ role: "instructor", permissions: ["take_pt"] }).includes("/instructor/pt-requests"));
});
