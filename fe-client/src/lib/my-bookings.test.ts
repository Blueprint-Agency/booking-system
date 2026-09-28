import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingItems, sessionsOnDay, sortForPhase, type BookingSources } from "./my-bookings.ts";

const NOW = Date.parse("2026-09-27T10:00:00+08:00");
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const empty: BookingSources = { upcoming: [], past: [], pt: [], workshops: [], corporate: [] };

// Only the fields the placing reads; the rest of each wire shape is irrelevant here.
const cls = (id: string, start: number, end: number, state = "confirmed") =>
  ({ booking_id: id, starts_at: at(start), ends_at: at(end), state }) as never;
const pt = (id: string, status: string, session?: [number, number]) =>
  ({
    id,
    status,
    slots: [{ proposed_date: "2026-09-30", start_time: "18:30", end_time: null }],
    created_at: at(-48),
    session: session ? { starts_at: at(session[0]), ends_at: at(session[1]), instructor_name: null, room_name: null } : null,
  }) as never;

const phases = (src: Partial<BookingSources>) =>
  Object.fromEntries(bookingItems({ ...empty, ...src }, NOW).map((i) => [i.key, i.phase]));

test("a class is upcoming until it starts, ongoing while it runs, past once it ends", () => {
  assert.deepEqual(
    phases({ upcoming: [cls("a", 2, 3)], past: [cls("b", -0.5, 0.5), cls("c", -3, -2)] }),
    { "class:a": "upcoming", "class:b": "ongoing", "class:c": "past" },
  );
});

test("a cancelled class that would still be running is past, not ongoing", () => {
  assert.deepEqual(phases({ past: [cls("b", -0.5, 0.5, "cancelled")] }), { "class:b": "past" });
});

test("a pending PT request is upcoming; a scheduled one follows its session; the rest are past", () => {
  assert.deepEqual(
    phases({
      pt: [
        pt("p", "pending"),
        pt("s", "scheduled", [24, 25]),
        pt("r", "scheduled", [-0.5, 0.5]),
        pt("x", "cancelled_before_scheduled"),
        pt("d", "attended", [-30, -29]),
      ],
    }),
    { "pt:p": "upcoming", "pt:s": "upcoming", "pt:r": "ongoing", "pt:x": "past", "pt:d": "past" },
  );
});

test("a workshop with no dates yet is upcoming; a cancelled one is past", () => {
  const w = (id: string, state: string, start: number | null, end: number | null) =>
    ({ id, state, booked_at: at(-100), starts_at: start == null ? null : at(start), ends_at: end == null ? null : at(end) }) as never;
  assert.deepEqual(
    phases({ workshops: [w("t", "confirmed", null, null), w("c", "cancelled", 5, 6), w("n", "confirmed", -1, 30)] }),
    { "workshop:t": "upcoming", "workshop:c": "past", "workshop:n": "ongoing" },
  );
});

test("a corporate request waiting to be scheduled is upcoming", () => {
  const r = (id: string, status: string) => ({ id, status, created_at: at(-10), session: null }) as never;
  assert.deepEqual(phases({ corporate: [r("p", "pending"), r("d", "attended")] }), {
    "corporate:p": "upcoming",
    "corporate:d": "past",
  });
});

test("a day's sessions are the ones its tile counted: attended, or booked and not yet started, earliest first", () => {
  const checkedIn = (c: unknown, state: string) => ({ ...(c as object), check_in_state: state }) as never;
  const items = bookingItems(
    {
      ...empty,
      upcoming: [cls("later", 3, 4), cls("tomorrow", 15, 16)],
      past: [
        checkedIn(cls("morning", -2, -1), "attended"),
        // Ran, but never ticked: the tile did not count it.
        checkedIn(cls("unticked", -3, -2), "pending"),
        cls("gone", -4, -3, "cancelled"),
        checkedIn(cls("n", -2, -1), "no_show"),
      ],
      pt: [
        pt("done", "attended", [-6, -5]),
        // Left scheduled after it ran: not attended, and no longer to come.
        pt("stale", "scheduled", [-8, -7]),
        pt("next", "scheduled", [6, 7]),
        pt("asked", "pending"),
        pt("dropped", "cancelled_after_scheduled", [5, 6]),
      ],
      workshops: [{ id: "w", state: "confirmed", booked_at: at(-100), starts_at: at(1), ends_at: at(2) } as never],
    },
    NOW,
  );
  assert.deepEqual(
    sessionsOnDay(items, "2026-09-27").map((i) => i.key),
    ["pt:done", "class:morning", "class:later", "pt:next"],
  );
  // 01:00 on the 28th in Singapore, still the 27th in UTC.
  assert.deepEqual(sessionsOnDay(items, "2026-09-28").map((i) => i.key), ["class:tomorrow"]);
});

test("coming items run soonest first, past ones most recent first", () => {
  const items = bookingItems({ ...empty, upcoming: [cls("late", 5, 6), cls("soon", 1, 2)], past: [cls("old", -9, -8), cls("new", -3, -2)] }, NOW);
  assert.deepEqual(sortForPhase(items.filter((i) => i.phase === "upcoming"), "upcoming").map((i) => i.key), ["class:soon", "class:late"]);
  assert.deepEqual(sortForPhase(items.filter((i) => i.phase === "past"), "past").map((i) => i.key), ["class:new", "class:old"]);
});
