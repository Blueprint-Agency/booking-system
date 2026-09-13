import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath, signedInRedirectTarget } from "./auth-redirect";

/** The rule as the login form asks it, from a path with its query string. */
const target = (path: string, superPortal: boolean) => {
  const url = new URL(path, "http://localhost:3001");
  return signedInRedirectTarget(url.pathname, url.searchParams, superPortal);
};

test("signed-in user on a studio's /login is sent to /admin", () => {
  assert.equal(target("/login", false), "/admin");
});

test("on the super portal the fallback is /platform, not /admin", () => {
  // `/admin` is a studio route with no Tenant to render here, so `portalRouting`
  // bounces it — a signed-in operator sent there never arrives.
  assert.equal(target("/login", true), "/platform");
});

test("the super portal still honours an explicit next", () => {
  assert.equal(target("/login?next=/platform", true), "/platform");
});

test("an unsafe next on the super portal falls back to /platform", () => {
  assert.equal(target("/login?next=https://evil.com", true), "/platform");
  assert.equal(target("/login?next=/login", true), "/platform");
});

test("honours a safe internal next", () => {
  assert.equal(target("/login?next=/instructor/schedule", false), "/instructor/schedule");
  assert.equal(target("/login?next=/admin/staff", false), "/admin/staff");
});

test("rejects external, protocol-relative, and looping next", () => {
  assert.equal(target("/login?next=https://evil.com", false), "/admin");
  assert.equal(target("/login?next=//evil.com", false), "/admin");
  assert.equal(target("/login?next=/login", false), "/admin");
});

test("other pages pass through", () => {
  assert.equal(target("/admin", false), null);
  assert.equal(target("/loginfoo", false), null);
  assert.equal(target("/platform", true), null);
});

test("a studio's set-password page is not a sign-in form, so it is left alone", () => {
  // An invitee who is already signed in as someone else must still be able to
  // open their link; the page itself decides what to do about the session.
  assert.equal(target("/signup?invite_token=t", false), null);
});

test("the next sanitiser", () => {
  assert.equal(safeNextPath(new URLSearchParams("next=/admin/staff")), "/admin/staff");
  assert.equal(safeNextPath(new URLSearchParams("next=https://evil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=//evil.com")), null);
  // A `next` back to the login page is the self-replace the pages used to do.
  assert.equal(safeNextPath(new URLSearchParams("next=/login")), null);
  assert.equal(safeNextPath(new URLSearchParams()), null);
});
