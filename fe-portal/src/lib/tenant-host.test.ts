import test from "node:test";
import assert from "node:assert/strict";
import {
  isSuperPortalHost,
  renamedTenantUrl,
  tenantSlugFromHost,
  withoutTenantHeaders,
} from "./tenant-host";

const LOCAL = "portal.localhost:3001";
const STAGING = "portal.dev.reservetoday.app";
const PROD = "portal.reservetoday.app";

test("local host with a port yields the slug", () => {
  assert.equal(tenantSlugFromHost("northwind.portal.localhost:3001", LOCAL), "northwind");
  assert.equal(tenantSlugFromHost("acme.portal.localhost:3001", LOCAL), "acme");
});

test("the port is irrelevant on both sides", () => {
  // A dev server moved to another port must not stop resolving tenants.
  assert.equal(tenantSlugFromHost("acme.portal.localhost:3007", LOCAL), "acme");
  assert.equal(tenantSlugFromHost("acme.portal.localhost", LOCAL), "acme");
});

test("staging host yields the slug", () => {
  assert.equal(
    tenantSlugFromHost("northwind.portal.dev.reservetoday.app", STAGING),
    "northwind",
  );
});

test("production host yields the slug", () => {
  assert.equal(tenantSlugFromHost("northwind.portal.reservetoday.app", PROD), "northwind");
});

test("the bare root domain has no slug", () => {
  assert.equal(tenantSlugFromHost("portal.localhost:3001", LOCAL), null);
  assert.equal(tenantSlugFromHost("portal.dev.reservetoday.app", STAGING), null);
  assert.equal(tenantSlugFromHost("portal.reservetoday.app", PROD), null);
});

test("www is not a tenant", () => {
  assert.equal(tenantSlugFromHost("www.portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("WWW.portal.reservetoday.app", PROD), null);
});

test("a reserved label is not a tenant", () => {
  // Mirrors the backend's reserved-slug list. `admin` is the one that bites
  // here: `admin.portal.…` is the super portal, not a studio.
  assert.equal(tenantSlugFromHost("admin.portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("admin.portal.localhost:3001", LOCAL), null);
  assert.equal(tenantSlugFromHost("api.portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("staging.portal.reservetoday.app", PROD), null);
});

test("an unknown slug still extracts — existence is the resolver's job", () => {
  assert.equal(tenantSlugFromHost("nosuchstudio.portal.reservetoday.app", PROD), "nosuchstudio");
});

test("a multi-level host under the root domain is not a tenant", () => {
  // A slug is one DNS label. `a.b.portal.reservetoday.app` leaves `a.b`, which
  // is not one, and must not be forwarded to the backend as if it were.
  assert.equal(tenantSlugFromHost("a.b.portal.reservetoday.app", PROD), null);
});

test("the client hostname is not a portal hostname", () => {
  // `acme.reservetoday.app` is fe-client's; the portal must not claim it.
  assert.equal(tenantSlugFromHost("acme.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("acme.localhost:3000", LOCAL), null);
});

test("a host outside the root domain has no slug", () => {
  // Vercel preview URLs, and anything else that isn't ours.
  assert.equal(tenantSlugFromHost("fe-portal-git-abc.vercel.app", PROD), null);
  assert.equal(tenantSlugFromHost("evilportal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("portal.reservetoday.app.evil.com", PROD), null);
});

test("hostnames are matched case-insensitively and without the root dot", () => {
  assert.equal(tenantSlugFromHost("ACME.Portal.ReserveToday.App", PROD), "acme");
  assert.equal(tenantSlugFromHost("acme.portal.reservetoday.app.", PROD), "acme");
});

test("a malformed label is not a slug", () => {
  assert.equal(tenantSlugFromHost("-acme.portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost("acme_two.portal.reservetoday.app", PROD), null);
  assert.equal(tenantSlugFromHost(`${"a".repeat(64)}.portal.reservetoday.app`, PROD), null);
});

test("a missing host or root domain yields no slug", () => {
  assert.equal(tenantSlugFromHost(null, PROD), null);
  assert.equal(tenantSlugFromHost("acme.portal.reservetoday.app", ""), null);
});

test("the super portal is the reserved `admin` label, in every environment", () => {
  assert.equal(isSuperPortalHost("admin.portal.localhost:3001", LOCAL), true);
  assert.equal(isSuperPortalHost("admin.portal.dev.reservetoday.app", STAGING), true);
  assert.equal(isSuperPortalHost("admin.portal.reservetoday.app", PROD), true);
  // Same normalisation as slug resolution — casing must not be able to smuggle
  // a studio onto the super portal's hostname, or off it.
  assert.equal(isSuperPortalHost("Admin.Portal.ReserveToday.App", PROD), true);
});

test("a studio's hostname is never the super portal", () => {
  assert.equal(isSuperPortalHost("northwind.portal.reservetoday.app", PROD), false);
  assert.equal(isSuperPortalHost("acme.portal.localhost:3001", LOCAL), false);
  // The bare root domain, a deeper name, and a foreign host are all not it.
  assert.equal(isSuperPortalHost("portal.reservetoday.app", PROD), false);
  assert.equal(isSuperPortalHost("admin.acme.portal.reservetoday.app", PROD), false);
  assert.equal(isSuperPortalHost("admin.portal.evil.example", PROD), false);
  assert.equal(isSuperPortalHost(null, PROD), false);
});

test("`admin` is not a tenant slug, so the two questions cannot both be yes", () => {
  assert.equal(tenantSlugFromHost("admin.portal.reservetoday.app", PROD), null);
});

// Both halves of the proxy — the studio portal's and the super portal's — start
// from this, so neither can forget that a caller must never name its own Tenant.

test("inbound tenant headers are dropped, whatever their casing", () => {
  const headers = withoutTenantHeaders(
    new Headers({
      "X-Tenant-Id": "forged",
      "x-tenant-slug": "acme",
      "X-TENANT-anything": "1",
      host: "acme.portal.reservetoday.app",
      authorization: "Bearer kept",
    }),
  );
  assert.equal(headers.get("x-tenant-id"), null);
  assert.equal(headers.get("x-tenant-slug"), null);
  assert.equal(headers.get("x-tenant-anything"), null);
  assert.equal(headers.get("host"), "acme.portal.reservetoday.app");
  assert.equal(headers.get("authorization"), "Bearer kept");
});

test("the headers handed in are not changed", () => {
  const inbound = new Headers({ "x-tenant-id": "forged" });
  withoutTenantHeaders(inbound);
  assert.equal(inbound.get("x-tenant-id"), "forged");
});

test("a renamed studio's old portal address moves to the same page on the new one", () => {
  assert.equal(
    renamedTenantUrl(
      {
        protocol: "https:",
        host: "old-name.portal.reservetoday.app",
        pathname: "/admin/schedule",
        search: "?week=2026-09-21",
      },
      "new-name",
    ),
    "https://new-name.portal.reservetoday.app/admin/schedule?week=2026-09-21",
  );
  assert.equal(
    renamedTenantUrl(
      { protocol: "http:", host: "old-name.portal.localhost:3001", pathname: "/login", search: "" },
      "new-name",
    ),
    "http://new-name.portal.localhost:3001/login",
  );
});
