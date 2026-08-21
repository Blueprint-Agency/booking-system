import test from "node:test";
import assert from "node:assert/strict";
import { signedInRedirectPath } from "./auth-redirect.ts";

const u = (path: string) => new URL(path, "http://localhost:3000");

test("signed-in user on /login is sent home", () => {
  assert.equal(signedInRedirectPath(u("/login")), "/");
});

test("signed-in user on /register is sent home", () => {
  assert.equal(signedInRedirectPath(u("/register")), "/");
});

test("honours a safe internal next", () => {
  assert.equal(signedInRedirectPath(u("/login?next=/account")), "/account");
});

test("rejects external and protocol-relative next", () => {
  assert.equal(signedInRedirectPath(u("/login?next=https://evil.com")), "/");
  assert.equal(signedInRedirectPath(u("/login?next=//evil.com")), "/");
});

test("rejects next that points back at an auth page (no loop)", () => {
  assert.equal(signedInRedirectPath(u("/login?next=/login")), "/");
  assert.equal(signedInRedirectPath(u("/login?next=/register")), "/");
});

test("impersonation ticket keeps /login reachable", () => {
  assert.equal(signedInRedirectPath(u("/login?__clerk_ticket=abc&next=/account")), null);
});

test("non-auth pages pass through", () => {
  assert.equal(signedInRedirectPath(u("/")), null);
  assert.equal(signedInRedirectPath(u("/account")), null);
  assert.equal(signedInRedirectPath(u("/loginfoo")), null);
});
