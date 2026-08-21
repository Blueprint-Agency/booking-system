import test from "node:test";
import assert from "node:assert/strict";
import { signedInRedirectPath } from "./auth-redirect";

const u = (path: string) => new URL(path, "http://localhost:3001");

test("signed-in user on /login is sent to /admin", () => {
  assert.equal(signedInRedirectPath(u("/login")), "/admin");
});

test("honours a safe internal next", () => {
  assert.equal(
    signedInRedirectPath(u("/login?next=/instructor/schedule")),
    "/instructor/schedule",
  );
});

test("rejects external, protocol-relative, and looping next", () => {
  assert.equal(signedInRedirectPath(u("/login?next=https://evil.com")), "/admin");
  assert.equal(signedInRedirectPath(u("/login?next=//evil.com")), "/admin");
  assert.equal(signedInRedirectPath(u("/login?next=/login")), "/admin");
});

test("other pages pass through", () => {
  assert.equal(signedInRedirectPath(u("/signup")), null);
  assert.equal(signedInRedirectPath(u("/admin")), null);
  assert.equal(signedInRedirectPath(u("/loginfoo")), null);
});
