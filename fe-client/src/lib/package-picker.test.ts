import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptsNone,
  activationLine,
  costLine,
  initialPick,
  nothingEligibleCopy,
  packageMeta,
  planCoverage,
  reasonText,
  type MyClassPackage,
} from "./package-picker.ts";

const EAST = { id: "loc-east", name: "Studio East" };
const WEST = { id: "loc-west", name: "Studio West" };

function pkg(over: Partial<MyClassPackage> & { id: string }): MyClassPackage {
  return {
    name: "Ten classes",
    kind: "credit_bundle",
    running: true,
    remaining: 10,
    expires_at: "2026-11-24T15:59:59.000Z",
    activation_end_if_picked: null,
    location: null,
    eligible: true,
    reason: null,
    ...over,
  };
}

test("BKG-29 pre-selects the Default payer the backend names", () => {
  const packages = [
    pkg({ id: "a" }),
    pkg({ id: "b", running: false, expires_at: null, activation_end_if_picked: "2027-01-10T15:59:59.000Z" }),
  ];
  assert.equal(initialPick({ default_client_package_id: "a", my_packages: packages }), "a");
});

test("BKG-29 never pre-selects a package that cannot pay, and pre-selects nothing when none can", () => {
  const packages = [
    pkg({ id: "a", eligible: false, reason: "insufficient_credits", remaining: 0 }),
    pkg({ id: "b" }),
  ];
  // A stale or missing default falls to the first row that can pay.
  assert.equal(initialPick({ default_client_package_id: "a", my_packages: packages }), "b");
  assert.equal(initialPick({ default_client_package_id: null, my_packages: packages }), "b");
  assert.equal(
    initialPick({ default_client_package_id: null, my_packages: [packages[0]!] }),
    null,
  );
  assert.equal(initialPick({ default_client_package_id: null, my_packages: [] }), null);
});

test("BKG-29 a greyed package says why it cannot pay", () => {
  assert.equal(
    reasonText(pkg({ id: "u", kind: "unlimited", remaining: null, location: EAST, eligible: false, reason: "location_not_covered" })),
    "Covers Studio East only",
  );
  assert.equal(reasonText(pkg({ id: "x", eligible: false, reason: "plan_expires_before_class" })), "Ends before this class");
  assert.equal(reasonText(pkg({ id: "y", eligible: false, reason: "insufficient_credits" })), "Not enough credits");
  assert.equal(reasonText(pkg({ id: "z" })), null);
});

test("BKG-31 a package the class's rule does not take says it is not accepted", () => {
  assert.equal(reasonText(pkg({ id: "n", eligible: false, reason: "not_accepted" })), "Not accepted for this class");
  // Whatever else is true of it: the rule is the reason the server gives first.
  assert.equal(
    reasonText(pkg({ id: "u", kind: "unlimited", remaining: null, location: EAST, eligible: false, reason: "not_accepted" })),
    "Not accepted for this class",
  );
});

test("BKG-31 with nothing eligible, an accepted package's reason comes before the rule's", () => {
  const refused = pkg({ id: "n", eligible: false, reason: "not_accepted" });
  const tooFew = pkg({ id: "y", eligible: false, reason: "insufficient_credits", remaining: 0 });
  // What is wrong with an accepted package is what the member can fix.
  assert.equal(nothingEligibleCopy([refused, tooFew]), "You don't have enough credits for this class.");
  // Only when the class takes none of them is that the reason.
  assert.equal(
    nothingEligibleCopy([refused, pkg({ id: "m", eligible: false, reason: "not_accepted" })]),
    "Your package isn't accepted for this class. Tap the class to see which packages are.",
  );
});

test("BKG-31 a class accepts none of the member's packages only when every one is refused by its rule", () => {
  const refused = pkg({ id: "n", eligible: false, reason: "not_accepted" });
  assert.equal(acceptsNone([refused]), true);
  assert.equal(acceptsNone([refused, { ...refused, id: "m" }]), true);
  assert.equal(acceptsNone([refused, pkg({ id: "y", eligible: false, reason: "insufficient_credits" })]), false);
  assert.equal(acceptsNone([refused, pkg({ id: "b" })]), false);
  // Holding nothing is being out of credits, not being refused by the rule.
  assert.equal(acceptsNone([]), false);
});

test("BKG-29 a Dormant pick says it starts today and when it would end", () => {
  const dormant = pkg({ id: "d", running: false, expires_at: null, activation_end_if_picked: "2027-01-10T15:59:59.000Z" });
  assert.equal(activationLine(dormant), "Starts today, runs until Sun, 10 Jan 2027");
  // A running package already has its end date; nothing starts.
  assert.equal(activationLine(pkg({ id: "r" })), null);
  assert.equal(packageMeta(dormant), "10 credits left · not started yet");
  assert.equal(packageMeta(pkg({ id: "r", remaining: 1 })), "1 credit left · until Tue, 24 Nov 2026");
  assert.equal(
    packageMeta(pkg({ id: "u", kind: "unlimited", remaining: null, location: WEST })),
    "Unlimited at Studio West · until Tue, 24 Nov 2026",
  );
});

test("BKG-29 the cost line reads from the picked package", () => {
  assert.equal(
    costLine(pkg({ id: "u", kind: "unlimited", remaining: null, location: EAST }), 2),
    "Covered by your Unlimited plan",
  );
  assert.equal(costLine(pkg({ id: "b" }), 1), "Uses 1 credit");
  assert.equal(costLine(pkg({ id: "t", kind: "trial", remaining: 1 }), 2), "Uses 2 credits");
});

test("BKG-29 with nothing eligible the sheet says the first reason in default order", () => {
  const notCovered = pkg({ id: "u", kind: "unlimited", remaining: null, location: EAST, eligible: false, reason: "location_not_covered" });
  const runsOut = pkg({ id: "x", eligible: false, reason: "plan_expires_before_class" });
  const tooFew = pkg({ id: "y", eligible: false, reason: "insufficient_credits", remaining: 0 });
  assert.equal(nothingEligibleCopy([notCovered, runsOut]), "Your plan covers Studio East only.");
  assert.equal(
    nothingEligibleCopy([runsOut, notCovered]),
    "Your current package runs out before this class starts, so it can't cover it.",
  );
  assert.equal(nothingEligibleCopy([tooFew]), "You don't have enough credits for this class.");
  assert.match(nothingEligibleCopy([])!, /class package/);
  // Any one package that can pay means there is nothing to explain.
  assert.equal(nothingEligibleCopy([notCovered, pkg({ id: "b" })]), null);
});

test("BKG-29 a class is not covered only when no Unlimited Plan covers its Location", () => {
  const east = { id: "p1", location: EAST, covers_both: false, running: true };
  const west = { id: "p2", location: WEST, covers_both: false, running: false };
  assert.deepEqual(planCoverage([east], WEST.id), {
    notCovered: true,
    planLocationName: "Studio East",
    addOnPlanId: "p1",
  });
  // A second plan homed at the class's Location covers it.
  assert.equal(planCoverage([east, west], WEST.id).notCovered, false);
  // Plans at several Locations name none of them as "the" plan's.
  assert.equal(planCoverage([east, west], WEST.id).planLocationName, null);
  // The Add-On makes a plan Cover every Location.
  assert.equal(planCoverage([{ ...east, covers_both: true }], WEST.id).notCovered, false);
  // No plan, nothing to be uncovered by.
  assert.equal(planCoverage([], WEST.id).notCovered, false);
  assert.equal(planCoverage(undefined, WEST.id).notCovered, false);
});
