import test from "node:test";
import assert from "node:assert/strict";
import { tenantSlugFromHost } from "./tenant-host.ts";

const LOCAL = "localhost:3000";
const STAGING = "dev.reservetoday.app";
const PROD = "reservetoday.app";

test("local host with a port yields the slug", () => {
  assert.equal(tenantSlugFromHost("yogasadhana.localhost:3000", LOCAL), "yogasadhana");
  assert.equal(tenantSlugFromHost("acme.localhost:3000", LOCAL), "acme");
});

test("the port is irrelevant on both sides", () => {
  // A dev server moved to another port must not stop resolving tenants.
  assert.equal(tenantSlugFromHost("acme.localhost:3005", LOCAL), "acme");
  assert.equal(tenantSlugFromHost("acme.localhost", LOCAL), "acme");
});

test("staging host yields the slug", () => {
  assert.equal(tenantSlugFromHost("yogasadhana.dev.reservetoday.app", STAGING), "yogasadhana");
});

test("production host yields the slug", () => {
  assert.equal(tenantSlugFromHost("yogasadhana.reservetoday.app", PROD), "yogasadhana");
});

test("the bare root domain has no slug", () => {
  assert.equal(tenantSlugFromHost("localhost:3000", LOCAL), null);
  assert.equal(tenantSlugFromHost("dev.reservetoday.app", STAGING), null);
  assert.equal(tenantSlugFromHost("reservetoday.app", PROD), null);
});

test("www is not a tenant", () => {
  assert.equal(tenantSlugFromHost("www.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("WWW.reservetoday.app", PROD), null);
});

test("a reserved label is not a tenant", () => {
  // Mirrors the backend's reserved-slug list, so a hostname something else
  // already answers on can never be read as a studio. `portal` is the one that
  // bites: `portal.reservetoday.app` is the whole other app.
  assert.equal(tenantSlugFromHost("portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("admin.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("api.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("dev.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("assets.reservetoday.app", PROD), null);
});

test("an unknown slug still extracts — existence is the resolver's job", () => {
  assert.equal(tenantSlugFromHost("nosuchstudio.reservetoday.app", PROD), "nosuchstudio");
});

test("a multi-level host under the root domain is not a tenant", () => {
  // A slug is one DNS label. `a.b.reservetoday.app` leaves `a.b`, which is not
  // one, and must not be forwarded to the backend as if it were.
  assert.equal(tenantSlugFromHost("a.b.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("acme.portal.localhost:3000", LOCAL), null);
});

test("a host outside the root domain has no slug", () => {
  // Vercel preview URLs, and anything else that isn't ours.
  assert.equal(tenantSlugFromHost("fe-client-git-abc.vercel.app", PROD), null);
  assert.equal(tenantSlugFromHost("evilreservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("reservetoday.app.evil.com", PROD), null);
});

test("hostnames are matched case-insensitively and without the root dot", () => {
  assert.equal(tenantSlugFromHost("ACME.ReserveToday.App", PROD), "acme");
  assert.equal(tenantSlugFromHost("acme.reservetoday.app.", PROD), "acme");
});

test("a malformed label is not a slug", () => {
  assert.equal(tenantSlugFromHost("-acme.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("acme_two.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost(`${"a".repeat(64)}.reservetoday.app`, PROD), null);
});

test("a missing host or root domain yields no slug", () => {
  assert.equal(tenantSlugFromHost(null, PROD), null);
  assert.equal(tenantSlugFromHost("acme.reservetoday.app", ""), null);
});
