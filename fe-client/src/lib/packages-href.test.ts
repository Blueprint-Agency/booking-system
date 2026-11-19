import assert from "node:assert";
import { test } from "node:test";
import { packagesHref } from "./packages-href.ts";

// Until the member Packages page reads one Entity at a time, every Entity's
// link is the one page, and a class with no Entity goes there too.
test("PKR-25 a class's buy-a-package link goes to the Packages page, whatever its Entity", () => {
  assert.equal(packagesHref({ slug: "pilates" }), "/packages");
  assert.equal(packagesHref(null), "/packages");
  assert.equal(packagesHref(), "/packages");
});
