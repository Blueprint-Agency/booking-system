import test from "node:test";
import assert from "node:assert/strict";
import { authLinksFor, safeNextPath, signedInRedirectTarget, signInPathFor } from "./auth-redirect.ts";

/** The rule as the login and register pages ask it, from a path with its query string. */
const target = (path: string) => {
  const url = new URL(path, "http://acme.localhost:3000");
  return signedInRedirectTarget(url.pathname, url.searchParams);
};

test("signed-in member on /login is sent home", () => {
  assert.equal(target("/login"), "/");
});

test("signed-in member on /register is sent home", () => {
  assert.equal(target("/register"), "/");
});

test("honours a safe internal next", () => {
  assert.equal(target("/login?next=/account"), "/account");
  assert.equal(target("/register?next=/checkout?package=p1"), "/checkout?package=p1");
});

test("rejects external and protocol-relative next", () => {
  assert.equal(target("/login?next=https://evil.com"), "/");
  assert.equal(target("/login?next=//evil.com"), "/");
});

test("rejects next that points back at an auth page (no loop)", () => {
  assert.equal(target("/login?next=/login"), "/");
  assert.equal(target("/login?next=/register"), "/");
});

test("non-auth pages pass through", () => {
  assert.equal(target("/"), null);
  assert.equal(target("/account"), null);
  assert.equal(target("/loginfoo"), null);
});

// The pages that need a member send a signed-out visitor to sign in, and the
// sign-in page sends them back. The two must agree, or the pair is a loop.

test("a signed-out visitor to a member page is sent to sign in, and back again", () => {
  const signIn = new URL(signInPathFor("/account/classes", "?tab=past"), "http://acme.localhost:3000");
  assert.equal(signIn.pathname, "/login");
  assert.equal(signedInRedirectTarget(signIn.pathname, signIn.searchParams), "/account/classes?tab=past");
});

test("the sign-in path never carries an auth page as its next", () => {
  const signIn = new URL(signInPathFor("/login", ""), "http://acme.localhost:3000");
  assert.equal(safeNextPath(signIn.searchParams), null);
});

test("AUTH-07 the top bar's Log in and Sign up bring the visitor back to the page they were on", () => {
  const { login, register } = authLinksFor("/workshops");
  for (const href of [login, register]) {
    const url = new URL(href, "http://acme.localhost:3000");
    assert.equal(url.searchParams.get("next"), "/workshops");
  }
  assert.equal(new URL(login, "http://acme.localhost:3000").pathname, "/login");
  assert.equal(new URL(register, "http://acme.localhost:3000").pathname, "/register");
});

test("the top bar's links carry no next from home or from an auth page", () => {
  assert.deepEqual(authLinksFor("/"), { login: "/login", register: "/register" });
  assert.deepEqual(authLinksFor("/login"), { login: "/login", register: "/register" });
  assert.deepEqual(authLinksFor("/register"), { login: "/login", register: "/register" });
});

test("the shared next sanitiser", () => {
  assert.equal(safeNextPath(new URLSearchParams("next=/account")), "/account");
  assert.equal(safeNextPath(new URLSearchParams("next=https://evil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=//evil.com")), null);
  // A browser reads a backslash after the leading slash as a second slash.
  assert.equal(safeNextPath(new URLSearchParams("next=/%5Cevil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=/login")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=/register")), null);
  assert.equal(safeNextPath(new URLSearchParams()), null);
});
