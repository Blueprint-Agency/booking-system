import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CUSTOMER_FILTER_LABEL,
  customerEntityFor,
  parseCustomerFilter,
  showCustomerEntityFilter,
  trialFunnelCopy,
} from "./customer-filter";

describe("Customers Trials filter by Entity", () => {
  test("CUS-32 the Entity choice is shown only under Trials and only for two or more Entities", () => {
    assert.equal(showCustomerEntityFilter("trials", 2), true);
    assert.equal(showCustomerEntityFilter("trials", 3), true);
    assert.equal(showCustomerEntityFilter("trials", 1), false, "one Entity filters nothing");
    assert.equal(showCustomerEntityFilter("trials", 0), false);
    for (const f of ["all", "active", "blocked", "no_email"] as const) assert.equal(showCustomerEntityFilter(f, 3), false);
  });

  test("CUS-32 the Entity is kept and sent only under Trials, so leaving Trials drops it", () => {
    assert.equal(customerEntityFor("trials", "e1"), "e1");
    assert.equal(customerEntityFor("trials", ""), "");
    assert.equal(customerEntityFor("trials", null), "");
    for (const f of ["all", "active", "blocked", "no_email"] as const) assert.equal(customerEntityFor(f, "e1"), "");
  });

  test("CUS-32 the funnel names the Entity it is read for, and the studio-wide wording stays without one", () => {
    assert.deepEqual(trialFunnelCopy("Pilates"), {
      heading: "Pilates trials",
      convertedHint: "Went on to pay for a Pilates package",
    });
    assert.deepEqual(trialFunnelCopy(null), { heading: null, convertedHint: "Went on to pay for a package" });
    assert.deepEqual(trialFunnelCopy(""), { heading: null, convertedHint: "Went on to pay for a package" });
  });
});

describe("Customers filter address", () => {
  test("ATN-129 ?filter=no_email selects the No email filter, labelled for people, and an unknown filter means all", () => {
    assert.equal(parseCustomerFilter("no_email"), "no_email");
    assert.equal(CUSTOMER_FILTER_LABEL.no_email, "No email");
    for (const f of ["active", "trials", "blocked"] as const) assert.equal(parseCustomerFilter(f), f);
    assert.equal(parseCustomerFilter("nonsense"), "all");
    assert.equal(parseCustomerFilter(null), "all");
  });
});
