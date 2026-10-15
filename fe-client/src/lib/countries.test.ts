import test from "node:test";
import assert from "node:assert/strict";
import { countryOptions } from "./countries.ts";

test("ACC-50 the Billing details country picker offers every country ISO 3166-1 assigns, by name, and no code that names none", () => {
  const options = countryOptions();
  const codes = new Set(options.map((o) => o.value));
  assert.equal(codes.size, 249, "the 249 codes ISO 3166-1 assigns");
  for (const code of ["SG", "MY", "GB", "AX", "BQ", "CW", "SS"]) assert.ok(codes.has(code), code);
  for (const code of ["EU", "UN", "EZ", "SU", "YU", "XK", "QO", "AC", "TA", "IC", "DG", "EA", "CP", "UK", "FX", "ZZ"]) {
    assert.ok(!codes.has(code), `${code} is not offered`);
  }
  assert.equal(options.find((o) => o.value === "SG")?.label, "Singapore");
  const labels = options.map((o) => o.label);
  assert.deepEqual(labels, [...labels].sort((x, y) => x.localeCompare(y)), "listed by name");
});
