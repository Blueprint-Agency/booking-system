import test from "node:test";
import assert from "node:assert/strict";
import { accessDeniedCopy, authFailure, refusalCode } from "./access-refusal";

test("no session at all is a sign-out", () => {
  assert.deepEqual(authFailure(401, null), { kind: "sign-out" });
});

test("a refused session is denied, not signed out — this is the loop", () => {
  // The bug: a platform admin on a studio's portal shares the portal's Clerk
  // cookie, so signing them out and reopening /login handed back the same
  // session and the same 403, forever.
  assert.deepEqual(authFailure(403, { error: "staff_not_provisioned" }), {
    kind: "denied",
    reason: "staff_not_provisioned",
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

test("a stale organization claim is transient, so it offers the retry", () => {
  // Reached only once the provider's automatic retries are spent. A genuine
  // staff member can land here, so the screen must not be a dead end.
  const copy = accessDeniedCopy("organization_required");
  assert.equal(copy.offerRetry, true);
  assert.equal(copy.offerSwitch, true);
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
    "organization_required",
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
