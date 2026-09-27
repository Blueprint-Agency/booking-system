import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleSentence, type RulePackage } from "./package-rule.ts";

const pack = (name: string, over: Partial<RulePackage> = {}): RulePackage => ({
  id: `pkg-${name}`,
  name,
  kind: "credit_bundle",
  archived: false,
  ...over,
});

test("BKG-32 a class that takes every package says so", () => {
  assert.equal(ruleSentence({ mode: "all", packages: [] }), "All packages");
});

test("BKG-32 an only rule names the packages it takes, in the order given", () => {
  assert.equal(
    ruleSentence({ mode: "only", packages: [pack("Ten classes"), pack("Monthly unlimited", { kind: "unlimited" })] }),
    "Only: Ten classes, Monthly unlimited",
  );
  assert.equal(ruleSentence({ mode: "only", packages: [pack("Trial", { kind: "trial" })] }), "Only: Trial");
});

test("BKG-32 an except rule names the packages it refuses", () => {
  assert.equal(ruleSentence({ mode: "except", packages: [pack("Trial", { kind: "trial" })] }), "All except: Trial");
});

test("an archived package is still named: members may hold one", () => {
  assert.equal(
    ruleSentence({ mode: "except", packages: [pack("Old pass", { archived: true })] }),
    "All except: Old pass",
  );
});

test("an empty list reads as what it means", () => {
  assert.equal(ruleSentence({ mode: "except", packages: [] }), "All packages");
  assert.equal(ruleSentence({ mode: "only", packages: [] }), "No packages");
});
