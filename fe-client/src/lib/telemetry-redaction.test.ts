import test from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_URL_PLACEHOLDER,
  redactTenantUrls,
  redactTenantUrlsDeep,
  tenantUrlRedactor,
} from "./telemetry-redaction.ts";
import { isTenantLabel } from "./tenant-host.ts";

const LOCAL = "localhost:3000";
const STAGING = "dev.reservetoday.app";
const PROD = "reservetoday.app";

test("a slug hostname is rewritten to the placeholder", () => {
  assert.equal(
    redactTenantUrls("https://northwind.reservetoday.app/classes", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/classes`,
  );
  assert.equal(
    redactTenantUrls("https://acme.dev.reservetoday.app/", STAGING),
    `https://${TENANT_URL_PLACEHOLDER}.dev.reservetoday.app/`,
  );
});

test("the local root domain's port survives the rewrite", () => {
  assert.equal(
    redactTenantUrls("http://acme.localhost:3000/book", LOCAL),
    `http://${TENANT_URL_PLACEHOLDER}.localhost:3000/book`,
  );
});

test("casing cannot smuggle a slug past the rewrite", () => {
  assert.equal(
    redactTenantUrls("https://Northwind.ReserveToday.app/x", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/x`,
  );
});

test("a reserved label is not rewritten", () => {
  // The super portal and the API have to stay recognisable in an error report.
  for (const host of ["www", "api", "admin", "portal", "app", "assets"]) {
    const url = `https://${host}.reservetoday.app/x`;
    assert.equal(redactTenantUrls(url, PROD), url);
  }
});

test("a reserved label in front of the Tenant's own is still not a Tenant", () => {
  assert.equal(
    redactTenantUrls("https://admin.portal.reservetoday.app/studios", PROD),
    "https://admin.portal.reservetoday.app/studios",
  );
});

test("the leading label is the Tenant even when other labels follow it", () => {
  assert.equal(
    redactTenantUrls("https://acme.portal.reservetoday.app/schedule", PROD),
    `https://${TENANT_URL_PLACEHOLDER}.portal.reservetoday.app/schedule`,
  );
});

test("a URL with no Tenant label is untouched", () => {
  assert.equal(redactTenantUrls("https://reservetoday.app/", PROD), "https://reservetoday.app/");
  assert.equal(
    redactTenantUrls("https://cdn.example.com/logo.png", PROD),
    "https://cdn.example.com/logo.png",
  );
  // A hostname that merely starts with the root domain is a different domain.
  assert.equal(
    redactTenantUrls("https://acme.reservetoday.apple/x", PROD),
    "https://acme.reservetoday.apple/x",
  );
});

test("paths, queries and uuids are untouched", () => {
  // A Tenant's uuid in a path is allowed — the rule is about names.
  const url = "https://acme.reservetoday.app/studio/acme/3f2b1c0e-0000-4000-8000-000000000000?from=acme";
  assert.equal(
    redactTenantUrls(url, PROD),
    `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/studio/acme/3f2b1c0e-0000-4000-8000-000000000000?from=acme`,
  );
});

test("a Tenant host nested in a query string is rewritten too", () => {
  // Including when it arrives percent-encoded, as a `next=` parameter does.
  assert.equal(
    redactTenantUrls("https://api.reservetoday.app/v1/x?next=https%3A%2F%2Facme.reservetoday.app%2Fy", PROD),
    `https://api.reservetoday.app/v1/x?next=https%3A%2F%2F${TENANT_URL_PLACEHOLDER}.reservetoday.app%2Fy`,
  );
  assert.equal(
    redactTenantUrls("https://api.reservetoday.app/v1/x?next=https://acme.reservetoday.app/y", PROD),
    `https://api.reservetoday.app/v1/x?next=https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/y`,
  );
});

test("two Tenant hosts in one string are both rewritten", () => {
  assert.equal(
    redactTenantUrls("from https://acme.reservetoday.app/a to https://northwind.reservetoday.app/b", PROD),
    `from https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/a to https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/b`,
  );
});

test("the deep walk rewrites every string, whatever it is nested in", () => {
  const item = {
    meta: {
      page: { url: "https://acme.reservetoday.app/classes", attributes: { referrer: "https://acme.reservetoday.app/" } },
      session: { id: "s1", attributes: { entryUrl: "https://acme.reservetoday.app/" } },
      view: { name: "default" },
      user: { id: "u1", attributes: { tenantId: "3f2b1c0e-0000-4000-8000-000000000000" } },
    },
    payload: {
      name: "faro.performance.navigation",
      attributes: { url: "https://acme.reservetoday.app/book", referrer: "https://acme.reservetoday.app/" },
      stacktrace: { frames: [{ filename: "https://acme.reservetoday.app/_next/static/chunk.js" }] },
    },
  };

  const out = redactTenantUrlsDeep(item, PROD) as typeof item;

  assert.equal(out.meta.page.url, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/classes`);
  assert.equal(out.meta.page.attributes.referrer, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/`);
  assert.equal(out.meta.session.attributes.entryUrl, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/`);
  assert.equal(out.payload.attributes.url, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/book`);
  assert.equal(out.payload.attributes.referrer, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/`);
  assert.equal(
    out.payload.stacktrace.frames[0]!.filename,
    `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/_next/static/chunk.js`,
  );
  // The Tenant is still on the event, by uuid.
  assert.equal(out.meta.user.attributes.tenantId, "3f2b1c0e-0000-4000-8000-000000000000");
  assert.equal(out.meta.view.name, "default");
});

test("the deep walk leaves non-strings alone and survives a cycle", () => {
  const cyclic: Record<string, unknown> = { url: "https://acme.reservetoday.app/", n: 1, ok: true, nothing: null };
  cyclic.self = cyclic;

  const out = redactTenantUrlsDeep(cyclic, PROD) as Record<string, unknown>;

  assert.equal(out.url, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/`);
  assert.equal(out.n, 1);
  assert.equal(out.ok, true);
  assert.equal(out.nothing, null);
});

test("the deep walk does not reach inside a class instance", () => {
  // Faro can carry the original Error on the item; rebuilding it is not ours to do.
  const error = new Error("boom at https://acme.reservetoday.app/");
  const out = redactTenantUrlsDeep({ originalError: error }, PROD) as { originalError: Error };
  assert.equal(out.originalError, error);
});

test("the before-send hook redacts the item and passes it on", () => {
  const redact = tenantUrlRedactor(PROD);
  const item = {
    type: "exception",
    meta: { page: { url: "https://acme.reservetoday.app/checkout" } },
    payload: { type: "Error", value: "boom" },
  };

  const out = redact(item as never) as unknown as typeof item;

  assert.ok(out);
  assert.equal(out.meta.page.url, `https://${TENANT_URL_PLACEHOLDER}.reservetoday.app/checkout`);
  assert.equal(out.payload.value, "boom");
});

test("the placeholder can never be a real slug", () => {
  // If it could, a redacted host would be indistinguishable from a real one.
  assert.equal(isTenantLabel(TENANT_URL_PLACEHOLDER), false);
  // And redacting twice is a no-op, so a re-sent event does not grow a second one.
  const once = redactTenantUrls("https://acme.reservetoday.app/x", PROD);
  assert.equal(redactTenantUrls(once, PROD), once);
});
