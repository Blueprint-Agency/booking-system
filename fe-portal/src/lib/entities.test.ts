import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import {
  defaultEntityId,
  entityFromApi,
  entityRefusal,
  filterByEntity,
  moveInOrder,
  moveNotice,
  packageEntityFromApi,
  showEntityFilter,
  slugFromName,
  usageSentence,
} from "./entities";

const ZERO = { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 };

test("SCH-64 an Entity read from the API keeps its name, slug and archived state, with usage as counts", () => {
  const entity = entityFromApi({
    id: "e1",
    name: "Pilates",
    slug: "pilates",
    position: 1,
    archived_at: null,
    in_use: { ...ZERO, class_packages: 2 },
  });
  assert.deepEqual(entity, {
    id: "e1",
    name: "Pilates",
    slug: "pilates",
    archivedAt: null,
    inUse: { ...ZERO, class_packages: 2 },
  });
});

test("SCH-64 moving an Entity up or down swaps it with its neighbour, and does nothing at either end", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveInOrder(ids, 1, "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInOrder(ids, 1, "down"), ["a", "c", "b"]);
  assert.deepEqual(moveInOrder(ids, 0, "up"), ids);
  assert.deepEqual(moveInOrder(ids, 2, "down"), ids);
  // The list it was given is left as it was.
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("SCH-64 the slug the form suggests from a name is the one the server would make", () => {
  assert.equal(slugFromName("Pilates"), "pilates");
  assert.equal(slugFromName("  Hot Yoga & Flow "), "hot-yoga-flow");
  assert.equal(slugFromName("Café Barre"), "cafe-barre");
  assert.equal(slugFromName("瑜伽"), "");
});

test("SCH-64 what is still in an Entity is said in words, kind by kind, and nothing is said of nothing", () => {
  assert.equal(usageSentence(ZERO), "");
  assert.equal(
    usageSentence({ class_types: 1, class_packages: 3, pt_packages: 0, corporate_packages: 2 }),
    "1 class type, 3 class packages, 2 corporate packages",
  );
  assert.equal(usageSentence({ ...ZERO, pt_packages: 1 }), "1 private session package");
});

test("SCH-64 each refusal the Entities screen can get is said as a sentence the admin can act on", () => {
  const refused = (status: number, body: Record<string, unknown>) => entityRefusal(new ApiError(status, body), "Save failed.");
  assert.match(refused(409, { error: "entity_name_taken" }), /already has that name/i);
  assert.match(refused(409, { error: "entity_slug_taken" }), /address/i);
  assert.match(refused(400, { error: "entity_slug_invalid" }), /letters, numbers and hyphens/i);
  assert.match(refused(409, { error: "cannot_archive_last_entity" }), /at least one/i);
  assert.equal(
    refused(409, { error: "entity_in_use", ...ZERO, class_types: 2, pt_packages: 1 }),
    "Still in use by 2 class types, 1 private session package. Move them to another entity first.",
  );
  assert.match(refused(400, { error: "entity_order_invalid" }), /reload/i);
  // What the API says in its own words wins for anything else; a non-API failure gets the fallback.
  assert.equal(refused(400, { error: "invalid_request", message: "An entity needs a name." }), "An entity needs a name.");
  assert.equal(entityRefusal(new Error("offline"), "Save failed."), "Save failed.");
});

test("PKG-78 a package form's Entity defaults to the studio's first, and a studio with none yet starts empty", () => {
  assert.equal(defaultEntityId([{ id: "yoga" }, { id: "pilates" }]), "yoga");
  assert.equal(defaultEntityId([]), "");
});

test("PKG-78 the packages list names each package's Entity and filters by it, but only a studio with two or more is offered the filter", () => {
  assert.equal(showEntityFilter([]), false);
  assert.equal(showEntityFilter([{ id: "a" }]), false);
  assert.equal(showEntityFilter([{ id: "a" }, { id: "b" }]), true);

  const rows = [
    { name: "Ten", entityId: "yoga" },
    { name: "Reformer", entityId: "pilates" },
    { name: "Old", entityId: null },
    { name: "Older" },
  ];
  assert.deepEqual(filterByEntity(rows, "pilates").map((r) => r.name), ["Reformer"]);
  assert.deepEqual(filterByEntity(rows, "").map((r) => r.name), ["Ten", "Reformer", "Old", "Older"]);

  assert.deepEqual(packageEntityFromApi({ entity_id: "e1", entity: { id: "e1", name: "Pilates", slug: "pilates" } }), {
    entityId: "e1",
    entityName: "Pilates",
  });
  // A row from an API that predates Entities carries neither field.
  assert.deepEqual(packageEntityFromApi({}), { entityId: null, entityName: null });
});

test("PKG-79 before a package is moved the admin is told how many members hold it, and that nothing is cancelled", () => {
  assert.equal(moveNotice(0), "No member holds this package, so nobody is affected by the move.");
  assert.equal(moveNotice(1), "1 member holds this package. It moves with it, and nothing is cancelled.");
  assert.equal(moveNotice(12), "12 members hold this package. It moves with it, and nothing is cancelled.");
});

test("PKG-79 a package save the API refused for its Entity says why in a sentence", () => {
  const refused = (error: string) => entityRefusal(new ApiError(409, { error }), "Save failed.");
  assert.match(refused("entity_archived"), /archived/i);
  assert.match(entityRefusal(new ApiError(404, { error: "entity_not_found" }), "Save failed."), /no longer exists/i);
});
