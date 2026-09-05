import test from "node:test";
import assert from "node:assert/strict";
import { organizationActivation } from "./active-organization";

const acme = { id: "org_acme", slug: "acme" };
const beta = { id: "org_beta", slug: "beta" };

test("a studio's portal activates that studio's organization", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "acme",
      activeOrganizationId: null,
      memberships: [acme, beta],
    }),
    { kind: "activate", organizationId: "org_acme" },
  );
});

test("a session already in the right organization is left alone", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "acme",
      activeOrganizationId: "org_acme",
      memberships: [acme, beta],
    }),
    { kind: "keep" },
  );
});

test("a session carrying another studio's organization is switched", () => {
  // This is the case the backend refuses with `tenant_mismatch`: a staff member
  // of two studios opening the second one's portal.
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "beta",
      activeOrganizationId: "org_acme",
      memberships: [acme, beta],
    }),
    { kind: "activate", organizationId: "org_beta" },
  );
});

test("a sole membership is used when no slug matches", () => {
  // A studio provisioned before organization slugs were set from ours, or one
  // whose slug Clerk had to adjust. Guessing is safe: the backend refuses a
  // wrong organization exactly as it refuses none.
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "acme",
      activeOrganizationId: null,
      memberships: [{ id: "org_legacy", slug: "yoga-sadhana-2019" }],
    }),
    { kind: "activate", organizationId: "org_legacy" },
  );
});

test("two memberships and no slug match is not guessed at", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "gamma",
      activeOrganizationId: null,
      memberships: [acme, beta],
    }),
    { kind: "unavailable" },
  );
});

test("no memberships at all is unavailable", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: "acme",
      activeOrganizationId: null,
      memberships: [],
    }),
    { kind: "unavailable" },
  );
});

test("the super portal clears any organization it is carrying", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: true,
      tenantSlug: null,
      activeOrganizationId: "org_acme",
      memberships: [acme],
    }),
    { kind: "clear" },
  );
});

test("the super portal with no organization is already correct", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: true,
      tenantSlug: null,
      activeOrganizationId: null,
      memberships: [acme],
    }),
    { kind: "keep" },
  );
});

test("a hostname naming no studio changes nothing", () => {
  assert.deepEqual(
    organizationActivation({
      superPortal: false,
      tenantSlug: null,
      activeOrganizationId: "org_acme",
      memberships: [acme],
    }),
    { kind: "keep" },
  );
});
