import test from "node:test";
import assert from "node:assert/strict";
import { IMPERSONATION_GRANT_COOKIE, grantCookie, readImpersonationHandoff } from "./impersonation-handoff.ts";

test("the portal's link carries the session token and the grant in the fragment", () => {
  const handoff = readImpersonationHandoff("#token=abc123&grant=eyJ.payload.sig");
  assert.deepEqual(handoff, { token: "abc123", grant: "eyJ.payload.sig" });
});

test("a link missing either half hands nothing over", () => {
  assert.equal(readImpersonationHandoff("#token=abc123"), null);
  assert.equal(readImpersonationHandoff("#grant=eyJ.payload.sig"), null);
  assert.equal(readImpersonationHandoff("#token=&grant="), null);
  assert.equal(readImpersonationHandoff(""), null);
});

test("the grant cookie lives as long as the grant, and is Secure only over https", () => {
  const overHttps = grantCookie("g", "https:");
  assert.match(overHttps, new RegExp(`^${IMPERSONATION_GRANT_COOKIE}=g;`));
  assert.match(overHttps, /max-age=3600/);
  assert.match(overHttps, /path=\//);
  assert.match(overHttps, /samesite=lax/);
  assert.match(overHttps, /secure/);
  assert.doesNotMatch(grantCookie("g", "http:"), /secure/);
});
