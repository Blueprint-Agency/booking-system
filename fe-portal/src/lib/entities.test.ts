import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import {
  classTypeBody,
  entityFromApi,
  entityRefusal,
  movePreviewSentence,
  moveInOrder,
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

test("SCH-77 the Class Type editor says what a move reaches, and always that nothing is cancelled", () => {
  assert.equal(
    movePreviewSentence({ upcoming_classes: 12, bookings: 31 }),
    "12 upcoming classes and 31 bookings are reached; nothing is cancelled.",
  );
  assert.equal(
    movePreviewSentence({ upcoming_classes: 1, bookings: 1 }),
    "1 upcoming class and 1 booking are reached; nothing is cancelled.",
  );
  assert.equal(movePreviewSentence({ upcoming_classes: 0, bookings: 0 }), "No upcoming classes or bookings are reached.");
});

test("SCH-77 a Class Type save sends its Entity for a top-level type and never for a sub-type", () => {
  const base = { name: "Yoga", description: "  Calm  ", difficulty: "general" };
  assert.deepEqual(classTypeBody({ ...base, parentId: null, entityId: "e1" }), {
    name: "Yoga",
    description: "Calm",
    difficulty: "general",
    parent_id: null,
    entity_id: "e1",
  });
  // The server refuses an Entity on a sub-type, even the parent's own.
  assert.equal("entity_id" in classTypeBody({ ...base, parentId: "p1", entityId: "e1" }), false);
  // A blank description is sent as null; no Entity chosen sends none.
  const blank = classTypeBody({ ...base, description: " ", parentId: null, entityId: null });
  assert.equal(blank.description, null);
  assert.equal("entity_id" in blank, false);
});

test("SCH-77 the refusals a Class Type save can get for its Entity are said as sentences", () => {
  const refused = (status: number, body: Record<string, unknown>) => entityRefusal(new ApiError(status, body), "Save failed.");
  assert.match(refused(400, { error: "class_type_entity_inherited" }), /parent's entity/i);
  assert.match(refused(409, { error: "entity_archived" }), /archived/i);
  assert.match(refused(404, { error: "entity_not_found" }), /no longer there/i);
});
