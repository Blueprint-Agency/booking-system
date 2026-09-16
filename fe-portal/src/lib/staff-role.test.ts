import test from "node:test";
import assert from "node:assert/strict";
import { runsStudio, visibleToRole } from "./staff-role";

test("an admin runs the studio; an instructor does not", () => {
  assert.equal(runsStudio("admin"), true);
  assert.equal(runsStudio("instructor"), false);
  assert.equal(runsStudio(null), false);
  assert.equal(runsStudio(undefined), false);
});

test("an admin sees every nav item, whatever its scope", () => {
  const items = [{ scope: "global" }, { scope: "workspace" }, { scope: "both" }] as const;
  assert.equal(items.filter(i => visibleToRole(i, "admin")).length, 3);
});

test("anyone else sees only the items both roles share", () => {
  const items = [{ scope: "global" }, { scope: "workspace" }, { scope: "both" }] as const;
  assert.deepEqual(
    items.filter(i => visibleToRole(i, "instructor")).map(i => i.scope),
    ["both"],
  );
  assert.deepEqual(
    items.filter(i => visibleToRole(i, null)).map(i => i.scope),
    ["both"],
  );
});
