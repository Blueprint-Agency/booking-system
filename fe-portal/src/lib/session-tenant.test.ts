import test from "node:test";
import assert from "node:assert/strict";
import { sessionTenantRefusal } from "./session-tenant";

const ACME = "aaaaaaaa-1111-4111-8111-111111111111";
const BETA = "bbbbbbbb-2222-4222-8222-222222222222";

test("a session signed in at this studio belongs here", () => {
  assert.equal(sessionTenantRefusal({ hostTenantId: ACME, claimedTenantId: ACME }), null);
});

test("a session signed in at another studio is refused as a mismatch", () => {
  // The case the backend answers `tenant_mismatch`: studio A's session opened on
  // studio B's portal. Said here so the refusal screen shows without first
  // sending a request that is designed to fail.
  assert.equal(
    sessionTenantRefusal({ hostTenantId: BETA, claimedTenantId: ACME }),
    "tenant_mismatch",
  );
});

test("a session that names no studio is refused as unclaimed", () => {
  // The backend never issues one on a studio pool, and refuses it everywhere if
  // it did. The same word as the backend's, so the copy is the same screen.
  assert.equal(
    sessionTenantRefusal({ hostTenantId: ACME, claimedTenantId: null }),
    "tenant_required",
  );
});

test("a hostname that names no studio decides nothing", () => {
  // The bare root domain, or a preview URL: there is no studio to compare
  // against, so the backend's answer is the one that counts.
  assert.equal(sessionTenantRefusal({ hostTenantId: null, claimedTenantId: ACME }), null);
  assert.equal(sessionTenantRefusal({ hostTenantId: null, claimedTenantId: null }), null);
});

test("ids are compared exactly, not loosely", () => {
  assert.equal(
    sessionTenantRefusal({ hostTenantId: ACME, claimedTenantId: ACME.toUpperCase() }),
    "tenant_mismatch",
  );
});
