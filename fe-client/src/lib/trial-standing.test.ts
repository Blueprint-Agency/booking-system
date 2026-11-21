import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trialClosedLabel,
  trialClosedText,
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
  trial_by_entity_type: {
    yoga: {
      group: { trial_used: true, trial_eligible: false },
      "1on1": { trial_used: false, trial_eligible: true },
      "2on1": { trial_used: false, trial_eligible: true },
    },
    pilates: {
      group: { trial_used: false, trial_eligible: true },
      "1on1": { trial_used: false, trial_eligible: false },
      "2on1": { trial_used: true, trial_eligible: false },
    },
  },
};

test("PKG-69 a trial reads the member's standing in its own Entity, not the studio's", () => {
  assert.deepEqual(trialStandingFor(ent, "yoga", "group"), { used: true, eligible: false });
  assert.deepEqual(trialStandingFor(ent, "pilates", "group"), { used: false, eligible: true });
});

test("PKG-83 a trial reads the standing of its own type: a group regular is still new to 1-on-1", () => {
  assert.deepEqual(trialStandingFor(ent, "yoga", "1on1"), { used: false, eligible: true });
  assert.deepEqual(trialStandingFor(ent, "pilates", "1on1"), { used: false, eligible: false });
  assert.deepEqual(trialStandingFor(ent, "pilates", "2on1"), { used: true, eligible: false });
});

test("PKG-69 signed out, every trial reads open", () => {
  assert.deepEqual(trialStandingFor(null, "yoga", "group"), { used: false, eligible: true });
  assert.deepEqual(trialStandingFor(null, "yoga", "2on1"), { used: false, eligible: true });
});

test("PKG-69 an Entity the server did not list, or a server that sends none, falls back to the studio-wide pair", () => {
  assert.deepEqual(trialStandingFor(ent, "barre", "group"), { used: true, eligible: false });
  assert.deepEqual(trialStandingFor(ent, null, "group"), { used: true, eligible: false });
  const older: TrialEntitlements = { trial_used: false, trial_eligible: true };
  assert.deepEqual(trialStandingFor(older, "yoga", "group"), { used: false, eligible: true });
});

test("PKG-83 a server from before PT trials: its per-Entity pair is the group trial's", () => {
  const { trial_by_entity_type: _dropped, ...older } = ent;
  assert.deepEqual(trialStandingFor(older, "pilates", "group"), { used: false, eligible: true });
  assert.deepEqual(trialStandingFor(older, "pilates", "1on1"), { used: true, eligible: false });
});

test("PKG-69 the wording names the Entity only when asked to, and a used trial reads Not eligible", () => {
  assert.equal(trialClosedLabel({ used: true, eligible: false }), "Not eligible");
  assert.equal(trialClosedLabel({ used: false, eligible: false }), "New members only");
  assert.match(trialClosedText(true, "Pilates", "group"), /used your Pilates group class trial/);
  assert.match(trialClosedText(false, null, "group"), /new to group classes\./);
});

test("PKG-83 the wording names the trial's type", () => {
  assert.match(trialClosedText(false, "Pilates", "1on1"), /Pilates 1-on-1 trial is for members new to 1-on-1 sessions at Pilates/);
  assert.match(trialClosedText(true, null, "2on1"), /used your 2-on-1 trial/);
});
