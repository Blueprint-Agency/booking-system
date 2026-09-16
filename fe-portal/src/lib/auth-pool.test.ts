import test from "node:test";
import assert from "node:assert/strict";
import { portalAuthBasePath, portalAuthPool } from "./auth-pool";

const ROOT = "portal.localhost:3001";

test("a studio's portal signs in on the staff pool", () => {
  assert.equal(portalAuthPool("northwind.portal.localhost:3001", ROOT), "staff");
  assert.equal(portalAuthBasePath("northwind.portal.localhost:3001", ROOT), "/auth/staff");
});

test("the super portal signs in on its own platform pool", () => {
  // Its own pool, not the staff one: a studio superadmin's credentials do not
  // exist there, so they cannot produce a super portal session at all.
  assert.equal(portalAuthPool("admin.portal.localhost:3001", ROOT), "platform");
  assert.equal(portalAuthBasePath("admin.portal.localhost:3001", ROOT), "/auth/platform");
  assert.equal(portalAuthPool("ADMIN.portal.localhost:3005", ROOT), "platform");
});

test("a host that names neither product falls to the staff pool", () => {
  // The staff pool refuses a sign-in that names no studio (`tenant_required`),
  // so the fallback admits nobody — where the platform pool would be a super
  // portal sign-in form on a hostname nobody reserved for one.
  for (const host of [null, undefined, "", "portal.localhost:3001", "northwind.localhost:3000", "preview.vercel.app"]) {
    assert.equal(portalAuthPool(host, ROOT), "staff", String(host));
  }
});
