import test from "node:test";
import assert from "node:assert/strict";
import {
  ptSlotDateProblem,
  ptWindowDates,
  ptWindowNotice,
  ptWindowPhrase,
  ptWindowRefusal,
  sgDatePlus,
} from "./pt-booking-window.ts";

// 2031-09-28 20:00 in Singapore (12:00 UTC), a Sunday.
const NOW = Date.UTC(2031, 8, 28, 12, 0);
// 2031-09-28 23:30 in Singapore: still the 28th there.
const LATE = Date.UTC(2031, 8, 28, 15, 30);
// 2031-09-29 00:30 in Singapore, though still the 28th in UTC.
const PAST_MIDNIGHT_SG = Date.UTC(2031, 8, 28, 16, 30);
const window = { minDays: 3, maxDays: 7 };

test("PT-122 the window counts Singapore calendar days from today", () => {
  assert.deepEqual(ptWindowDates(window, NOW), { earliest: "2031-10-01", latest: "2031-10-05" });
  assert.equal(sgDatePlus(0, LATE), "2031-09-28");
  assert.equal(sgDatePlus(0, PAST_MIDNIGHT_SG), "2031-09-29");
});

test("PT-122 the notice names the rule and the dates it allows today", () => {
  assert.equal(ptWindowNotice(window, NOW), "Book at least 3 days ahead, up to 7 days ahead (Wed 1 Oct – Sun 5 Oct).");
  assert.equal(ptWindowPhrase({ minDays: 1, maxDays: 14 }), "from tomorrow, up to 14 days ahead");
  assert.equal(ptWindowNotice({ minDays: 2, maxDays: 2 }, NOW), "Book at least 2 days ahead, up to 2 days ahead (Tue 30 Sep).");
});

test("PT-122 a date outside the window is named in the member's words; one inside is fine", () => {
  assert.equal(ptSlotDateProblem("2031-09-30", 1, window, NOW), "Time 1: pick a date from Wed 1 Oct.");
  assert.equal(ptSlotDateProblem("2031-10-06", 2, window, NOW), "Time 2: pick a date up to Sun 5 Oct.");
  assert.equal(ptSlotDateProblem("2031-10-01", 1, window, NOW), null);
  assert.equal(ptSlotDateProblem("2031-10-05", 1, window, NOW), null);
});

test("PT-122 the server's date refusals read as the rule; other codes are left to the caller", () => {
  const line = "Private sessions are booked at least 3 days ahead, up to 7 days ahead. Change any time outside that.";
  assert.equal(ptWindowRefusal("slot_date_too_soon", window), line);
  assert.equal(ptWindowRefusal("slot_date_too_far", window), line);
  assert.equal(ptWindowRefusal("insufficient_pt_credit", window), null);
});
