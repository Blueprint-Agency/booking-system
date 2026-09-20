import test from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_URL_PLACEHOLDER,
  redactTenantUrls,
  redactTenantUrlsDeep,
  tenantUrlRedactor,
} from "./telemetry-redaction";
import { isTenantLabel } from "./tenant-host";

const LOCAL = "portal.localhost:3001";
const STAGING = "portal.dev.reservetoday.app";
const PROD = "portal.reservetoday.app";

test("a slug hostname is rewritten to the placeholder", () => {
  assert.equal(
    redactTenantUrls("https://northwind.portal.reservetoday.app/schedule", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/schedule`,
  );
  assert.equal(
    redactTenantUrls("https://acme.portal.dev.reservetoday.app/", STAGING),
    `https://${TENANT_URL_PLACEHOLDER}.portal.dev.reservetoday.app/`,
  );
});

test("the local root domain's port survives the rewrite", () => {
  assert.equal(
    redactTenantUrls("http://acme.portal.localhost:3001/members", LOCAL),
    `http://${TENANT_URL_PLACEHOLDER}.portal.localhost:3001/members`,
  );
});

test("casing cannot smuggle a slug past the rewrite", () => {
  assert.equal(
    redactTenantUrls("https://Northwind.Portal.ReserveToday.app/x", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/x`,
  );
});

test("the super portal's own hostname is not rewritten", () => {
  // `admin` is reserved, so a super-portal error stays recognisable as one.
  assert.equal(
    redactTenantUrls("https://admin.portal.reservetoday.app/studios", PROD),
    "https://admin.portal.reservetoday.app/studios",
  );
});

test("a reserved label is not rewritten", () => {
  for (const host of ["www", "api", "admin", "portal", "app", "assets"]) {
    const url = `https://${host}.portal.reservetoday.app/x`;
    assert.equal(redactTenantUrls(url, PROD), url);
  }
});

test("a member app hostname on a portal event is rewritten too", () => {
  // A cross-app link's referrer is on the member app's root, not this one's.
  assert.equal(
    redactTenantUrls("https://acme.reservetoday.app/classes", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/classes`,
  );
  assert.equal(
    redactTenantUrls("http://acme.localhost:3000/classes", LOCAL),
    `http://${TENANT_URL_PLACEHOLDER}.localhost:3000/classes`,
  );
  // And the member app's own reserved labels still pass through.
  assert.equal(
    redactTenantUrls("https://www.reservetoday.app/", PROD),
    "https://www.reservetoday.app/",
  );
});

test("a URL with no Tenant label is untouched", () => {
  assert.equal(
    redactTenantUrls("https://portal.reservetoday.app/", PROD),
    "https://portal.reservetoday.app/",
  );
  assert.equal(
    redactTenantUrls("https://cdn.example.com/logo.png", PROD),
    "https://cdn.example.com/logo.png",
  );
  // A hostname that merely starts with the root domain is a different domain.
  assert.equal(
    redactTenantUrls("https://acme.portal.reservetoday.apple/x", PROD),
    "https://acme.portal.reservetoday.apple/x",
  );
});

test("paths, queries and uuids are untouched", () => {
  // A Tenant's uuid in a path is allowed — the rule is about names.
  const url =
    "https://acme.portal.reservetoday.app/members/acme/3f2b1c0e-0000-4000-8000-000000000000?from=acme";
  assert.equal(
    redactTenantUrls(url, PROD),
    `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/members/acme/3f2b1c0e-0000-4000-8000-000000000000?from=acme`,
  );
});

test("a Tenant host nested in a query string is rewritten too", () => {
  // Including when it arrives percent-encoded, as a `next=` parameter does.
  assert.equal(
    redactTenantUrls(
      "https://api.reservetoday.app/v1/x?next=https%3A%2F%2Facme.portal.reservetoday.app%2Fy",
      PROD,
    ),
    `https://api.reservetoday.app/v1/x?next=https%3A%2F%2F${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app%2Fy`,
  );
});

test("two Tenant hosts in one string are both rewritten", () => {
  assert.equal(
    redactTenantUrls(
      "from https://acme.portal.reservetoday.app/a to https://northwind.portal.reservetoday.app/b",
      PROD,
    ),
    `from https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/a to https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/b`,
  );
});

test("the deep walk rewrites every string, whatever it is nested in", () => {
  const item = {
    meta: {
      page: {
        url: "https://acme.portal.reservetoday.app/schedule",
        attributes: { referrer: "https://acme.portal.reservetoday.app/" },
      },
      session: { id: "s1", attributes: { entryUrl: "https://acme.portal.reservetoday.app/" } },
      view: { name: "default" },
      user: { id: "u1", attributes: { tenantId: "3f2b1c0e-0000-4000-8000-000000000000" } },
    },
    payload: {
      name: "faro.performance.navigation",
      attributes: {
        url: "https://acme.portal.reservetoday.app/members",
        referrer: "https://acme.portal.reservetoday.app/",
      },
      stacktrace: {
        frames: [{ filename: "https://acme.portal.reservetoday.app/_next/static/chunk.js" }],
      },
    },
  };

  const out = redactTenantUrlsDeep(item, PROD) as typeof item;

  assert.equal(out.meta.page.url, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/schedule`);
  assert.equal(out.meta.page.attributes.referrer, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/`);
  assert.equal(out.meta.session.attributes.entryUrl, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/`);
  assert.equal(out.payload.attributes.url, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/members`);
  assert.equal(out.payload.attributes.referrer, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/`);
  assert.equal(
    out.payload.stacktrace.frames[0]!.filename,
    `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/_next/static/chunk.js`,
  );
  // The Tenant is still on the event, by uuid.
  assert.equal(out.meta.user.attributes.tenantId, "3f2b1c0e-0000-4000-8000-000000000000");
  assert.equal(out.meta.view.name, "default");
});

test("the deep walk leaves non-strings alone and survives a cycle", () => {
  const cyclic: Record<string, unknown> = {
    url: "https://acme.portal.reservetoday.app/",
    n: 1,
    ok: true,
    nothing: null,
  };
  cyclic.self = cyclic;

  const out = redactTenantUrlsDeep(cyclic, PROD) as Record<string, unknown>;

  assert.equal(out.url, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/`);
  assert.equal(out.n, 1);
  assert.equal(out.ok, true);
  assert.equal(out.nothing, null);
});

test("the deep walk does not reach inside a class instance", () => {
  // Faro can carry the original Error on the item; rebuilding it is not ours to do.
  const error = new Error("boom at https://acme.portal.reservetoday.app/");
  const out = redactTenantUrlsDeep({ originalError: error }, PROD) as { originalError: Error };
  assert.equal(out.originalError, error);
});

test("the before-send hook redacts the item and passes it on", () => {
  const redact = tenantUrlRedactor(PROD);
  const item = {
    type: "exception",
    meta: { page: { url: "https://acme.portal.reservetoday.app/members" } },
    payload: { type: "Error", value: "boom" },
  };

  const out = redact(item as never) as unknown as typeof item;

  assert.ok(out);
  assert.equal(out.meta.page.url, `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/members`);
  assert.equal(out.payload.value, "boom");
});

test("the placeholder can never be a real slug", () => {
  // If it could, a redacted host would be indistinguishable from a real one.
  assert.equal(isTenantLabel(TENANT_URL_PLACEHOLDER), false);
  // And redacting twice is a no-op, so a re-sent event does not grow a second one.
  const once = redactTenantUrls("https://acme.portal.reservetoday.app/x", PROD);
  assert.equal(redactTenantUrls(once, PROD), once);
});
