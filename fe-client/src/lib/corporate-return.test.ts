import test from "node:test";
import assert from "node:assert/strict";
import { corporateArrival, corporateRequestSentHref } from "./corporate-return.ts";

const PACKAGE = "6f1d6c1e-6e0a-4d4e-9d5b-3d1d0c7a2b11";

test("CORP-03 a corporate package with nothing to pay lands on the member's corporate bookings, told the request is in", () => {
  const href = corporateRequestSentHref(PACKAGE);
  const url = new URL(href, "https://studio.example");
  assert.equal(url.pathname, "/account/bookings");
  assert.equal(url.searchParams.get("type"), "corporate");
  assert.deepEqual(corporateArrival(url.searchParams), { packageId: PACKAGE, sessionId: null });
});

test("CORP-03 the paid return names the package and the provider's session, for the page to confirm", () => {
  const params = new URLSearchParams(
    `type=corporate&submitted=corporate&package_id=${PACKAGE}&session_id=cs_test_123`,
  );
  assert.deepEqual(corporateArrival(params), { packageId: PACKAGE, sessionId: "cs_test_123" });
});

test("an ordinary visit to Your bookings is no corporate arrival", () => {
  assert.equal(corporateArrival(new URLSearchParams("type=corporate")), null);
  assert.equal(corporateArrival(new URLSearchParams("submitted=pt")), null);
});
