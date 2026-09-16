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

// The login page asks the same question on the client, because a
// `router.push("/login")` from inside the app never reaches the edge. If the
// two answers could differ, the pair of them would be the loop.

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
