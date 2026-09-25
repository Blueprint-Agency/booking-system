import test from "node:test";
import assert from "node:assert/strict";
import { grantCookie, readImpersonationGrant } from "./impersonation-handoff.ts";

test("the grant the hand-off stored is the grant read back", () => {
  const grant = "eyJhbGciOi.payload+/=.sig";
  const stored = grantCookie(grant, "https:").split(";")[0]!;
  assert.equal(readImpersonationGrant(`theme=dark; ${stored}; other=1`), grant);
});

test("no grant cookie reads as not impersonating", () => {
  assert.equal(readImpersonationGrant("theme=dark; other=1"), null);
  assert.equal(readImpersonationGrant(""), null);
});

test("a cookie whose name merely ends in the grant's name is not the grant", () => {
  assert.equal(readImpersonationGrant("x__imp_grant=abc"), null);
});
