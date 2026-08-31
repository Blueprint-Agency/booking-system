import test from "node:test";
import assert from "node:assert/strict";
import { portalRouting } from "./super-portal";

const STUDIO = false;
const SUPER = true;

test("a studio's hostname has no /platform section at all", () => {
  assert.deepEqual(portalRouting("/platform", STUDIO), { kind: "not-found" });
  assert.deepEqual(portalRouting("/platform/tenants", STUDIO), { kind: "not-found" });
});

test("a studio's own routes are untouched", () => {
  assert.deepEqual(portalRouting("/admin/schedule", STUDIO), { kind: "pass" });
  assert.deepEqual(portalRouting("/instructor/roster", STUDIO), { kind: "pass" });
  assert.deepEqual(portalRouting("/", STUDIO), { kind: "pass" });
});

test("a path that merely starts with the same letters is not the section", () => {
  // `/platformer` is not under `/platform`, on either hostname.
  assert.deepEqual(portalRouting("/platformer", STUDIO), { kind: "pass" });
  assert.deepEqual(portalRouting("/platformer", SUPER), {
    kind: "redirect",
    to: "/platform",
  });
});

test("the super portal serves its own section", () => {
  assert.deepEqual(portalRouting("/platform", SUPER), { kind: "pass" });
  assert.deepEqual(portalRouting("/platform/tenants", SUPER), { kind: "pass" });
});

test("a studio route on the super portal's hostname is a wrong turn, not a page", () => {
  // There is no Tenant context here, so these would render nothing anyway.
  assert.deepEqual(portalRouting("/admin/schedule", SUPER), {
    kind: "redirect",
    to: "/platform",
  });
  assert.deepEqual(portalRouting("/", SUPER), { kind: "redirect", to: "/platform" });
});

test("sign-in works on both hostnames", () => {
  for (const superPortal of [STUDIO, SUPER]) {
    assert.deepEqual(portalRouting("/login", superPortal), { kind: "pass" });
    assert.deepEqual(portalRouting("/login/factor-one", superPortal), { kind: "pass" });
    assert.deepEqual(portalRouting("/signup", superPortal), { kind: "pass" });
  }
});
