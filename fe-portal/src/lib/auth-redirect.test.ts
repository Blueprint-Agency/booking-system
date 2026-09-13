import test from "node:test";
import assert from "node:assert/strict";
import {
  safeNextPath,
  signedInRedirectPath,
  signedInRedirectTarget,
} from "./auth-redirect";

const u = (path: string) => new URL(path, "http://localhost:3001");
/** The super portal's own hostname, under the local `ROOT_DOMAIN`. */
const su = (path: string) => new URL(path, "http://admin.portal.localhost:3001");

test("signed-in user on /login is sent to /admin", () => {
  assert.equal(signedInRedirectPath(u("/login")), "/admin");
});

test("on the super portal the fallback is /platform, not /admin", () => {
  // `/admin` is a studio route with no Tenant to render here, so `portalRouting`
  // bounces it — a signed-in superadmin sent there never arrives.
  assert.equal(signedInRedirectPath(su("/login")), "/platform");
});

test("the super portal still honours an explicit next", () => {
  assert.equal(signedInRedirectPath(su("/login?next=/platform")), "/platform");
});

test("an unsafe next on the super portal falls back to /platform", () => {
  assert.equal(signedInRedirectPath(su("/login?next=https://evil.com")), "/platform");
  assert.equal(signedInRedirectPath(su("/login?next=/login")), "/platform");
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

// On a studio's portal the login page is the only one asking: the staff session
// is a bearer token in the page's storage, invisible to the edge. On the super
// portal the edge asks too (Clerk's cookie is visible there), and if the two
// answers could differ, the pair of them would be the loop.

test("a signed-in staff member on a studio's /login goes to the studio home", () => {
  const params = new URLSearchParams();
  assert.equal(signedInRedirectTarget("/login", params, false), "/admin");
  assert.equal(
    signedInRedirectTarget("/login", new URLSearchParams("next=/admin/staff"), false),
    "/admin/staff",
  );
});

test("a studio's set-password page is not a sign-in form, so it is left alone", () => {
  // An invitee who is already signed in as someone else must still be able to
  // open their link; the page itself decides what to do about the session.
  assert.equal(signedInRedirectTarget("/signup", new URLSearchParams("invite_token=t"), false), null);
});

test("the client form of the rule answers exactly as the edge does", () => {
  for (const [path, superPortal] of [
    ["/login", false],
    ["/login", true],
    ["/login?next=/instructor/schedule", false],
    ["/login?next=/login", false],
    ["/login?next=//evil.com", true],
    ["/admin", false],
  ] as const) {
    const url = new URL(path, superPortal ? "http://admin.portal.localhost:3001" : "http://localhost:3001");
    assert.equal(
      signedInRedirectTarget(url.pathname, url.searchParams, superPortal),
      signedInRedirectPath(url),
      `${path} (superPortal=${superPortal})`,
    );
  }
});

test("the shared next sanitiser refuses everything the edge refuses", () => {
  assert.equal(safeNextPath(new URLSearchParams("next=/admin/staff")), "/admin/staff");
  assert.equal(safeNextPath(new URLSearchParams("next=https://evil.com")), null);
  assert.equal(safeNextPath(new URLSearchParams("next=//evil.com")), null);
  // A `next` back to the login page is the self-replace the pages used to do.
  assert.equal(safeNextPath(new URLSearchParams("next=/login")), null);
  assert.equal(safeNextPath(new URLSearchParams()), null);
});
