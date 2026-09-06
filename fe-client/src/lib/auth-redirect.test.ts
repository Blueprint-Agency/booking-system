import test from "node:test";
import assert from "node:assert/strict";
import {
  safeNextPath,
  signedInRedirectPath,
  signedInRedirectTarget,
} from "./auth-redirect.ts";

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

// The login and register pages ask the same question on the client, because a
// `router.push("/login")` from inside the app never reaches the edge. If the
// two answers could differ, the pair of them would be the loop.

test("the client form of the rule answers exactly as the edge does", () => {
  for (const path of [
    "/login",
    "/register",
    "/login/factor-one",
    "/login?next=/account",
    "/login?next=/register",
    "/register?__clerk_ticket=abc",
    "/login?__clerk_ticket=abc&next=/account",
    "/account",
  ]) {
    const url = u(path);
    assert.equal(
      signedInRedirectTarget(url.pathname, url.searchParams),
      signedInRedirectPath(url),
      path,
    );
  }
});

test("a ticket keeps /register reachable too, not just /login", () => {
  // The edge lets it through by design; a client-side redirect of our own
  // would burn the ticket on the way past.
  assert.equal(signedInRedirectTarget("/register", new URLSearchParams("__clerk_ticket=abc")), null);
});

test("the shared next sanitiser refuses everything the edge refuses", () => {
  assert.equal(safeNextPath(new URLSearchParams("next=/account")), "/account");
  assert.equal(safeNextPath(new URLSearchParams("next=https://evil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=//evil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=/login")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=/register")), null);
  assert.equal(safeNextPath(new URLSearchParams()), null);
});
