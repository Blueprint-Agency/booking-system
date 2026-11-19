import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trialClosedLabel,
  trialClosedText,
  trialRefusalText,
  trialStandingFor,
  type TrialEntitlements,
} from "./trial-standing.ts";

const ent: TrialEntitlements = {
  trial_used: true,
  trial_eligible: false,
  trial_by_entity: {
    yoga: { trial_used: true, trial_eligible: false },
    pilates: { trial_used: false, trial_eligible: true },
  },
};

test("PKG-69 a trial reads the member's standing in its own Entity, not the studio's", () => {
  assert.deepEqual(trialStandingFor(ent, "yoga"), { used: true, eligible: false });
  assert.deepEqual(trialStandingFor(ent, "pilates"), { used: false, eligible: true });
});

test("PKG-69 signed out, every trial reads open", () => {
  assert.deepEqual(trialStandingFor(null, "yoga"), { used: false, eligible: true });
});

test("PKG-69 an Entity the server did not list, or a server that sends none, falls back to the studio-wide pair", () => {
  assert.deepEqual(trialStandingFor(ent, "barre"), { used: true, eligible: false });
  assert.deepEqual(trialStandingFor(ent, null), { used: true, eligible: false });
  const older: TrialEntitlements = { trial_used: false, trial_eligible: true };
  assert.deepEqual(trialStandingFor(older, "yoga"), { used: false, eligible: true });
});

test("PKG-69 the wording names the Entity only when asked to, and a used trial reads Not eligible", () => {
  assert.equal(trialClosedLabel({ used: true, eligible: false }), "Not eligible");
  assert.equal(trialClosedLabel({ used: false, eligible: false }), "New members only");
  assert.equal(trialRefusalText("trial_already_used", null), "You've already used your trial pass.");
  assert.equal(trialRefusalText("trial_already_used", "Pilates"), "You've already used your Pilates trial pass.");
  assert.equal(trialRefusalText("trial_not_eligible", null), "The trial pass is for new members only.");
  assert.match(trialRefusalText("trial_not_eligible", "Pilates"), /new to Pilates/);
  assert.match(trialClosedText(true, "Pilates"), /used your Pilates trial pass/);
  assert.match(trialClosedText(false, null), /new members only/);
});
