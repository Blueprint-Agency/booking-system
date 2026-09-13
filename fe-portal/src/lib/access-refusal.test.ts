import test from "node:test";
import assert from "node:assert/strict";
import { accessDeniedCopy, authFailure, refusalCode } from "./access-refusal";

test("no session at all is a sign-out", () => {
  // A token the staff pool no longer knows: signed out in another tab, expired,
  // or ended when the account was archived.
  assert.deepEqual(authFailure(401, { error: "invalid_token" }), { kind: "sign-out" });
  assert.deepEqual(authFailure(401, null), { kind: "sign-out" });
});

test("a refused session is denied, not signed out", () => {
  // A real staff session with no row at this studio. Signing it out without a
  // word put the person back on the login page with no idea why.
  assert.deepEqual(authFailure(403, { error: "staff_not_provisioned" }), {
    kind: "denied",
    reason: "staff_not_provisioned",
  });
});

test("a session from another studio is denied with the backend's own reason", () => {
  assert.deepEqual(authFailure(403, { error: "tenant_mismatch" }), {
    kind: "denied",
    reason: "tenant_mismatch",
  });
});

test("a refusal with no readable code is still a denial", () => {
  assert.deepEqual(authFailure(403, "gateway said no"), {
    kind: "denied",
    reason: null,
  });
});

test("anything else is left for the caller to report", () => {
  assert.deepEqual(authFailure(500, { error: "boom" }), { kind: "other" });
  assert.deepEqual(authFailure(null, null), { kind: "other" });
});

test("the refusal code is read only from a JSON object body", () => {
  assert.equal(refusalCode({ error: "tenant_mismatch" }), "tenant_mismatch");
  assert.equal(refusalCode({ error: 42 }), null);
  assert.equal(refusalCode(null), null);
  assert.equal(refusalCode("tenant_mismatch"), null);
});

test("a suspended studio is not the account's fault, and offers no switch", () => {
  // `requireActiveTenant` answers this to every one of a studio's staff. They
  // are staff; the studio is shut. "Use another account" would be advice that
  // cannot work, and naming their account would be an accusation.
  const copy = accessDeniedCopy("tenant_suspended");
  assert.equal(copy.namesAccount, false);
  assert.equal(copy.offerSwitch, false);
  assert.match(copy.detail, /suspended/);
});

test("a session that names no studio is fixed by signing in again, not by retrying", () => {
  // The claim is written once, at sign-in, so asking again with the same
  // session gets the same answer. Only a new session can carry this studio.
  const copy = accessDeniedCopy("tenant_required");
  assert.equal(copy.offerRetry, false);
  assert.equal(copy.offerSwitch, true);
  assert.match(copy.detail, /sign in again/);
});

test("the account-shaped refusals each get their own words", () => {
  assert.match(accessDeniedCopy("staff_inactive").detail, /isn't active/);
  assert.match(accessDeniedCopy("tenant_mismatch").detail, /different studio/);
  assert.match(
    accessDeniedCopy("staff_not_provisioned").detail,
    /isn't a staff member/,
  );
});

test("an unknown refusal still produces a whole, switchable screen", () => {
  for (const reason of ["something_the_backend_added_later", null]) {
    const copy = accessDeniedCopy(reason);
    assert.ok(copy.title.length > 0);
    assert.match(copy.detail, /isn't a staff member/);
    assert.equal(copy.namesAccount, true);
    assert.equal(copy.offerSwitch, true);
  }
});

test("every refusal offers at least one way out", () => {
  // This screen replaces the whole shell, so a case with neither button is a
  // trap with no exit but a hard reload.
  for (const reason of [
    "tenant_suspended",
    "tenant_required",
    "staff_inactive",
    "tenant_mismatch",
    "staff_not_provisioned",
    null,
  ]) {
    const copy = accessDeniedCopy(reason);
    assert.ok(
      copy.offerSwitch || copy.offerRetry,
      `${reason} offers no way out`,
    );
  }
});
