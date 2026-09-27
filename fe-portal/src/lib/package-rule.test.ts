import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import { staffBookingRefusal } from "./class-seats";
import { addToClassRefusal, paymentStatusLine, staffJoinRefusal } from "./class-waitlist";
import {
  ACCEPTS_ALL_DRAFT,
  acceptsLine,
  draftFromRule,
  groupPackages,
  packageRuleBody,
  packageRuleProblem,
  pickerPackages,
  rulePackageFromApi,
  ruleSentence,
  SERIES_EDIT_RULE_HINT,
  sameRule,
  togglePackage,
  wouldCancelCopy,
  type RulePackage,
} from "./package-rule";
import { scheduleErrorMessage } from "./schedule";
import { updateSeriesRule } from "./series";
import type { Api } from "./api";

// A class's Package rule (#323): which class packages may pay for it.

const pkg = (id: string, name: string, kind: RulePackage["kind"], archived = false): RulePackage => ({
  id,
  name,
  kind,
  archived,
});

const aerial = pkg("p1", "Aerial 10-pack", "credit_bundle");
const monthly = pkg("p2", "Unlimited Monthly", "unlimited");
const intro = pkg("p3", "Intro Trial", "trial");
const oldPack = pkg("p4", "Old 5-pack", "credit_bundle", true);
const oldPlan = pkg("p5", "Legacy Unlimited", "unlimited", true);

test("PKR-14 the rule reads as one sentence: all, only these, or all except these", () => {
  assert.equal(ruleSentence({ mode: "all", packages: [] }), "All packages");
  assert.equal(
    ruleSentence({ mode: "only", packages: [aerial, monthly] }),
    "Only: Aerial 10-pack, Unlimited Monthly",
  );
  assert.equal(ruleSentence({ mode: "except", packages: [intro] }), "All except: Intro Trial");
  // "All except" nothing excepts nothing.
  assert.equal(ruleSentence({ mode: "except", packages: [] }), "All packages");
  assert.equal(
    acceptsLine({ mode: "only", packages: [aerial, monthly] }),
    "Accepts: Only: Aerial 10-pack, Unlimited Monthly",
  );
});

test("the checklist groups active packages by kind, and archived ones under their own heading", () => {
  const groups = groupPackages([intro, oldPack, aerial, monthly, oldPlan]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.packages.map((p) => p.name)]),
    [
      ["Unlimited Plans", ["Unlimited Monthly"]],
      ["Credit Bundles", ["Aerial 10-pack"]],
      ["Trials", ["Intro Trial"]],
      ["Archived", ["Legacy Unlimited", "Old 5-pack"]],
    ],
  );
});

test("search keeps the packages whose name matches, ignoring case, and drops empty groups", () => {
  const all = [intro, oldPack, aerial, monthly, oldPlan];
  assert.deepEqual(
    groupPackages(all, "  PACK ").map((g) => [g.key, g.packages.map((p) => p.id)]),
    [
      ["credit_bundle", ["p1"]],
      ["archived", ["p4"]],
    ],
  );
  assert.deepEqual(groupPackages(all, "nothing like it"), []);
  assert.deepEqual(groupPackages([]), []);
});

test("a package the saved rule names is offered even if the catalogue read missed it", () => {
  assert.deepEqual(
    pickerPackages([aerial], [aerial, oldPack]).map((p) => p.id),
    ["p1", "p4"],
  );
});

test("a catalogue row becomes a picker package; archived by status, and never a PT package", () => {
  assert.deepEqual(rulePackageFromApi({ id: "p4", name: "Old 5-pack", kind: "credit_bundle", status: "archived" }), oldPack);
  assert.deepEqual(rulePackageFromApi({ id: "p2", name: "Unlimited Monthly", kind: "unlimited", status: "active" }), monthly);
  assert.equal(rulePackageFromApi({ id: "x", name: "PT 5", kind: "pt", status: "active" }), null);
});

test("the request body sends the mode and the ticked packages, and none under All packages", () => {
  assert.deepEqual(packageRuleBody(ACCEPTS_ALL_DRAFT), { mode: "all", package_ids: [] });
  assert.deepEqual(packageRuleBody({ mode: "only", packageIds: ["p2", "p1", "p2"] }), {
    mode: "only",
    package_ids: ["p1", "p2"],
  });
  assert.deepEqual(packageRuleBody({ mode: "except", packageIds: ["p3"] }), {
    mode: "except",
    package_ids: ["p3"],
  });
  // Ticks survive a switch to All packages in the field, but aren't sent.
  assert.deepEqual(packageRuleBody({ mode: "all", packageIds: ["p1"] }), { mode: "all", package_ids: [] });
});

test("ticking and unticking a package", () => {
  const one = togglePackage({ mode: "only", packageIds: [] }, "p1");
  assert.deepEqual(one, { mode: "only", packageIds: ["p1"] });
  assert.deepEqual(togglePackage(one, "p1"), { mode: "only", packageIds: [] });
});

test("Only these with nothing ticked is caught before it is sent", () => {
  assert.equal(
    packageRuleProblem({ mode: "only", packageIds: [] }),
    "Tick at least one package, or choose All packages.",
  );
  assert.equal(packageRuleProblem({ mode: "only", packageIds: ["p1"] }), null);
  assert.equal(packageRuleProblem({ mode: "except", packageIds: [] }), null);
  assert.equal(packageRuleProblem(ACCEPTS_ALL_DRAFT), null);
});

test("the editor sees a rule as changed only when it accepts something different", () => {
  const saved = draftFromRule({ mode: "only", packages: [aerial, monthly] });
  assert.deepEqual(saved, { mode: "only", packageIds: ["p1", "p2"] });
  assert.equal(sameRule(saved, { mode: "only", packageIds: ["p2", "p1"] }), true);
  assert.equal(sameRule(saved, { mode: "only", packageIds: ["p1"] }), false);
  assert.equal(sameRule(saved, { mode: "except", packageIds: ["p1", "p2"] }), false);
  // An empty "all except" is "all"; ticks left behind under All packages don't count.
  assert.equal(sameRule(draftFromRule(null), { mode: "except", packageIds: [] }), true);
  assert.equal(sameRule(draftFromRule({ mode: "all", packages: [] }), { mode: "all", packageIds: ["p1"] }), true);
});

test("PKR-14 a rule change that cancels bookings says how many, in the singular for one", () => {
  const one = wouldCancelCopy(1);
  assert.equal(one.title, "This will cancel 1 booking");
  assert.equal(one.confirm, "Cancel 1 booking and save");
  assert.match(one.body, /credit goes back/);
  assert.match(one.body, /emailed/);
  const three = wouldCancelCopy(3);
  assert.equal(three.title, "This will cancel 3 bookings");
  assert.match(three.body, /credits go back/);
  assert.match(three.body, /emailed/);
});

test("PKR-15 the rule's own refusals read as sentences on the scheduling forms", () => {
  assert.equal(
    scheduleErrorMessage(new ApiError(400, { error: "package_rule_empty" })),
    '"Only these" needs at least one package. Tick at least one package, or choose All packages.',
  );
  assert.equal(
    scheduleErrorMessage(new ApiError(400, { error: "package_rule_invalid_package", package_ids: ["x"] })),
    "One of those packages is no longer one of the studio's class packages. Reload and pick again.",
  );
});

test("PKR-15 not_accepted: staff booking, waitlist join and Add to class say the class takes none of the member's packages", () => {
  const refused = new ApiError(409, { error: "not_accepted" });
  const copy = "This class doesn't accept any of this member's packages.";
  assert.deepEqual(staffBookingRefusal(refused, "admin"), { kind: "error", message: copy });
  assert.deepEqual(staffBookingRefusal(refused, "instructor"), { kind: "error", message: copy });
  assert.equal(staffJoinRefusal(refused), copy);
  assert.deepEqual(addToClassRefusal(refused, "admin"), { kind: "error", message: copy });
});

test("PKR-15 not_accepted: a waiting member whose packages the class doesn't take says so on their row", () => {
  assert.equal(
    paymentStatusLine({ status: "cannot_pay", reason: "not_accepted" }),
    "Can't pay: this class doesn't accept their packages",
  );
});

test("PKR-14 a series' rule is replaced with one PUT, and the panel says it reaches only the classes an Extend adds", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const series = { id: "s1", package_rule: { mode: "except", packages: [intro] } };
  const api = {
    put: async (path: string, body: unknown) => {
      calls.push({ path, body });
      return series;
    },
  } as unknown as Api;
  const saved = await updateSeriesRule(api, "s1", packageRuleBody({ mode: "except", packageIds: ["p3"] }));
  assert.deepEqual(calls, [
    { path: "/portal/admin/schedule/series/s1/package-rule", body: { mode: "except", package_ids: ["p3"] } },
  ]);
  assert.equal(acceptsLine(saved.package_rule), "Accepts: All except: Intro Trial");
  assert.equal(
    SERIES_EDIT_RULE_HINT,
    "Applies to classes this series adds from now on (Extend). Classes already made keep their own rule — change those on each class.",
  );
});
