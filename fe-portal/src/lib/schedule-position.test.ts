import test from "node:test";
import assert from "node:assert";
import {
  isPlainDay,
  openingPosition,
  parseStoredPosition,
  positionFromSearch,
  positionSearch,
} from "./schedule-position";

const TODAY = "2026-11-11";

test("SCH-46 a timetable left on another week opens on that week and view when staff come back to the bare timetable", () => {
  const left = { date: "2026-11-09", view: "week" as const };
  const stored = parseStoredPosition(JSON.stringify(left));
  assert.deepStrictEqual(
    openingPosition({ fromAddress: positionFromSearch(""), stored, today: TODAY, phone: false }),
    left,
  );
  // On a phone too: the view staff last chose beats the phone's day-view default.
  assert.deepStrictEqual(
    openingPosition({ fromAddress: positionFromSearch(""), stored, today: TODAY, phone: true }),
    left,
  );
});

test("SCH-46 the timetable's address round-trips its position, and wins over the tab's", () => {
  const pos = { date: "2026-11-16", view: "month" as const };
  const stored = { date: "2026-11-09", view: "week" as const };
  assert.deepStrictEqual(positionFromSearch(positionSearch(pos)), pos);
  assert.deepStrictEqual(
    openingPosition({ fromAddress: positionFromSearch(positionSearch(pos)), stored, today: TODAY, phone: false }),
    pos,
  );
  // An address naming only the day keeps the default view for the rest.
  assert.deepStrictEqual(
    openingPosition({ fromAddress: positionFromSearch("?date=2026-11-16"), stored, today: TODAY, phone: true }),
    { date: "2026-11-16", view: "day" },
  );
});

test("SCH-46 with nothing kept, the timetable opens on today: week view, or day view on a phone", () => {
  const none = positionFromSearch("");
  assert.deepStrictEqual(openingPosition({ fromAddress: none, stored: null, today: TODAY, phone: false }), {
    date: TODAY,
    view: "week",
  });
  assert.deepStrictEqual(openingPosition({ fromAddress: none, stored: null, today: TODAY, phone: true }), {
    date: TODAY,
    view: "day",
  });
});

test("SCH-48 the List is a view the timetable keeps like the grids, in its address and for the tab", () => {
  assert.deepStrictEqual(positionFromSearch("?date=2026-11-16&view=list"), { date: "2026-11-16", view: "list" });
  assert.strictEqual(positionSearch({ date: "2026-11-16", view: "list" }), "?date=2026-11-16&view=list");
  assert.deepStrictEqual(parseStoredPosition(JSON.stringify({ date: "2026-11-16", view: "list" })), {
    date: "2026-11-16",
    view: "list",
  });
});

test("SCH-46 a day or view that is not real, in the address or the tab, reads as absent", () => {
  assert.deepStrictEqual(positionFromSearch("?date=2026-02-30&view=year"), {});
  assert.deepStrictEqual(positionFromSearch("?date=2026-13-01"), {});
  assert.deepStrictEqual(positionFromSearch("?date=26-11-09"), {});
  assert.strictEqual(parseStoredPosition("not json"), null);
  assert.strictEqual(parseStoredPosition(JSON.stringify({ date: "2026-11-09", view: "year" })), null);
  assert.strictEqual(parseStoredPosition(JSON.stringify({ date: "2026-02-29", view: "week" })), null);
  assert.strictEqual(parseStoredPosition(null), null);
  assert.strictEqual(isPlainDay("2028-02-29"), true);
  assert.strictEqual(isPlainDay("0000-01-01"), false);
});
