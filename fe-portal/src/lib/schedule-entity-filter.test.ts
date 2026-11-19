import test from "node:test";
import assert from "node:assert/strict";
import { liveEntities, showEntityFilter } from "./entities";
import { entityFilterOptions, entityFilterQuery } from "./schedule-entity-filter";
import { scheduleEntryFromApi, type ApiScheduleEntry } from "./schedule-entry";

const YOGA = { id: "e1", name: "Yoga" };
const PILATES = { id: "e2", name: "Pilates" };

const apiEntry = (over: Partial<ApiScheduleEntry>): ApiScheduleEntry => ({
  kind: "class",
  id: "c1",
  workshop_id: null,
  label: "Hatha",
  subtitle: null,
  class_type_id: "t1",
  main_instructor_id: "i1",
  supporting_instructor_ids: [],
  instructor_ids: ["i1"],
  location_id: "l1",
  room_id: null,
  starts_at: "2026-09-01T02:00:00.000Z",
  ends_at: "2026-09-01T03:00:00.000Z",
  capacity: 10,
  booked_count: 0,
  event_state: "scheduled",
  day_index: null,
  day_count: null,
  ...over,
});

test("SCH-84 the schedule's Entity filter is offered only when the studio has two or more Entities", () => {
  assert.equal(showEntityFilter([]), false);
  assert.equal(showEntityFilter([YOGA]), false);
  assert.equal(showEntityFilter([YOGA, PILATES]), true);
});

test("SCH-84 the filter's choices are All, then each Entity by name in the order the studio set", () => {
  assert.deepEqual(entityFilterOptions([YOGA, PILATES]), [
    { val: "", label: "All" },
    { val: "e1", label: "Yoga" },
    { val: "e2", label: "Pilates" },
  ]);
});

test("SCH-84 a pick narrows the read only while it names one of two or more Entities; All, a vanished Entity and a one-Entity studio send no filter", () => {
  assert.equal(entityFilterQuery("e2", [YOGA, PILATES]), "e2");
  assert.equal(entityFilterQuery("", [YOGA, PILATES]), undefined);
  // An Entity archived since the pick: the read is not narrowed to an id the pill no longer offers.
  assert.equal(entityFilterQuery("gone", [YOGA, PILATES]), undefined);
  // One Entity: the filter is hidden, so it can never narrow the read.
  assert.equal(entityFilterQuery("e1", [YOGA]), undefined);
});

test("SCH-84 the Entities the schedule offers are read from the admin's list or the instructor catalog, id and name each, and a backend with none reads as no Entities", () => {
  assert.deepEqual(
    liveEntities({
      entities: [
        {
          id: "e1",
          name: "Yoga",
          slug: "yoga",
          position: 0,
          archived_at: null,
          in_use: { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 },
        },
      ],
    }).map(({ id, name }) => ({ id, name })),
    [YOGA],
  );
  // An archived one is not offered (the instructor catalog never sends one).
  assert.deepEqual(
    liveEntities({
      entities: [
        { id: "e1", name: "Yoga", slug: "yoga", position: 0 },
        { id: "e9", name: "Old", slug: "old", position: 1, archived_at: "2026-01-01T00:00:00.000Z" },
      ],
    }).map(({ id, name }) => ({ id, name })),
    [YOGA],
  );
  assert.deepEqual(liveEntities(null), []);
});

test("SCH-84 a class entry keeps its Entity when read from the API, and every other kind has none; a backend from before Entities reads as none", () => {
  assert.equal(scheduleEntryFromApi(apiEntry({ entity_id: "e2" })).kind, "class");
  const cls = scheduleEntryFromApi(apiEntry({ entity_id: "e2" }));
  assert.equal(cls.kind === "class" ? cls.entityId : "not a class", "e2");
  const old = scheduleEntryFromApi(apiEntry({}));
  assert.equal(old.kind === "class" ? old.entityId : "not a class", null);
});
