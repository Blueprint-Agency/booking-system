import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CUSTOMER_FILTER_LABEL, parseCustomerFilter } from "./customer-filter";

describe("Customers filter address", () => {
  test("ATN-129 ?filter=no_email selects the No email filter, labelled for people, and an unknown filter means all", () => {
    assert.equal(parseCustomerFilter("no_email"), "no_email");
    assert.equal(CUSTOMER_FILTER_LABEL.no_email, "No email");
    for (const f of ["active", "trials", "blocked"] as const) assert.equal(parseCustomerFilter(f), f);
    assert.equal(parseCustomerFilter("nonsense"), "all");
    assert.equal(parseCustomerFilter(null), "all");
  });
});
