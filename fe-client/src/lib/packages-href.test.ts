import assert from "node:assert";
import { test } from "node:test";
import { packagesHref } from "./packages-href.ts";

// A class's link goes to its own Entity's Packages page; a class with no
// Entity goes to the Packages page, which opens on the first Entity.
test("PKR-25 a class's buy-a-package link goes to its Entity's Packages page", () => {
  assert.equal(packagesHref({ slug: "pilates" }), "/packages/pilates");
  assert.equal(packagesHref(null), "/packages");
  assert.equal(packagesHref(), "/packages");
});
