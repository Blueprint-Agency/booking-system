import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import { staffCancelCanConfirm, staffCancelCopy, staffCancelRefusal, type StaffCancelPreview } from "./staff-cancel";

const paid: StaffCancelPreview = { credits: 1, package_name: "10-Class Pass", unlimited: false, late: false };

test("CXL-53 a booking that spent a credit offers Return and Keep, naming the package", () => {
  const copy = staffCancelCopy(paid, "Ada Lovelace");
  assert.equal(copy.title, "Cancel Ada Lovelace's booking?");
  assert.deepEqual(copy.options, [
    { value: "return", label: "Return 1 credit to 10-Class Pass" },
    { value: "keep", label: "Keep the credit — recorded as a late cancel" },
  ]);
  assert.equal(copy.nothingSpent, null);
  assert.equal(copy.confirm, "Cancel booking");
});

test("more than one credit is counted, and a package without a name is still addressed", () => {
  assert.deepEqual(staffCancelCopy({ ...paid, credits: 2, package_name: null }, "Ada").options, [
    { value: "return", label: "Return 2 credits to their package" },
    { value: "keep", label: "Keep the credits — recorded as a late cancel" },
  ]);
});

test("CXL-53 the dialog says whether the class is already inside its Cancellation Window", () => {
  assert.equal(
    staffCancelCopy(paid, "Ada").window,
    "The class is not yet inside its cancellation window.",
  );
  assert.equal(
    staffCancelCopy({ ...paid, late: true }, "Ada").window,
    "The class is already inside its cancellation window.",
  );
});

test("CXL-53 a booking that spent nothing says so instead of offering a choice", () => {
  const unlimited = staffCancelCopy({ credits: 0, package_name: null, unlimited: true, late: false }, "Ada");
  assert.equal(unlimited.options, null);
  assert.equal(unlimited.nothingSpent, "Their plan is unlimited, so no credit was spent — nothing to return or keep.");
  const spentNothing = staffCancelCopy({ credits: 0, package_name: "Comp", unlimited: false, late: false }, "Ada");
  assert.equal(spentNothing.options, null);
  assert.equal(spentNothing.nothingSpent, "No credit was spent on this booking — nothing to return or keep.");
});

test("CXL-53 confirm waits for a choice, unless there is nothing to choose", () => {
  assert.equal(staffCancelCanConfirm(paid, null), false);
  assert.equal(staffCancelCanConfirm(paid, "return"), true);
  assert.equal(staffCancelCanConfirm(paid, "keep"), true);
  assert.equal(staffCancelCanConfirm({ ...paid, credits: 0, unlimited: true }, null), true);
});

test("a refused cancel is worded for staff", () => {
  const refused = (error: string) => new ApiError(409, { error }, "/x");
  assert.equal(
    staffCancelRefusal(refused("booking_attended")),
    "They're marked attended. Untick them first, then cancel.",
  );
  assert.equal(staffCancelRefusal(refused("not_your_session")), "This class is not one you are teaching.");
  assert.equal(staffCancelRefusal(refused("not_cancellable")), "This booking is no longer booked. Reload to see it.");
});
