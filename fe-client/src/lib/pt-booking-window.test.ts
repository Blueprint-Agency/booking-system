import test from "node:test";
import assert from "node:assert/strict";
import {
  ptSlotDateProblem,
  ptWindowDates,
  ptWindowNotice,
  ptWindowPhrase,
  ptWindowRefusal,
} from "./pt-booking-window.ts";
import { datePlus } from "./studio-time.ts";

const SINGAPORE = "Asia/Singapore";
const SYDNEY = "Australia/Sydney";

// 2031-09-28 20:00 in Singapore (12:00 UTC), a Sunday.
const NOW = Date.UTC(2031, 8, 28, 12, 0);
// 2031-09-28 23:30 in Singapore: still the 28th there.
const LATE = Date.UTC(2031, 8, 28, 15, 30);
// 2031-09-29 00:30 in Singapore, though still the 28th in UTC.
const PAST_MIDNIGHT_SG = Date.UTC(2031, 8, 28, 16, 30);
// 2031-09-29 00:30 in Sydney (UTC+10 until daylight saving starts on 5 October)
// is 22:30 on the 28th in Singapore and 14:30 on the 28th in UTC.
const PAST_MIDNIGHT_SYDNEY = Date.UTC(2031, 8, 28, 14, 30);
const window = { minDays: 3, maxDays: 7 };

test("PT-122 the window counts the studio's calendar days from today", () => {
  assert.deepEqual(ptWindowDates(window, SINGAPORE, NOW), { earliest: "2031-10-01", latest: "2031-10-05" });
  assert.equal(datePlus(SINGAPORE, 0, LATE), "2031-09-28");
  assert.equal(datePlus(SINGAPORE, 0, PAST_MIDNIGHT_SG), "2031-09-29");
});

test("TEN-89 a Sydney studio's window starts from Sydney's today, a day on from Singapore's and UTC's at that instant", () => {
  assert.deepEqual(ptWindowDates(window, SYDNEY, PAST_MIDNIGHT_SYDNEY), { earliest: "2031-10-02", latest: "2031-10-06" });
  assert.deepEqual(ptWindowDates(window, SINGAPORE, PAST_MIDNIGHT_SYDNEY), { earliest: "2031-10-01", latest: "2031-10-05" });
  assert.deepEqual(ptWindowDates(window, "UTC", PAST_MIDNIGHT_SYDNEY), { earliest: "2031-10-01", latest: "2031-10-05" });
  assert.equal(
    ptWindowNotice(window, SYDNEY, PAST_MIDNIGHT_SYDNEY),
    "Choose dates 3 to 7 days from today (Thu 2 Oct – Mon 6 Oct).",
  );
  assert.equal(ptSlotDateProblem("2031-10-01", 1, window, SYDNEY, PAST_MIDNIGHT_SYDNEY), "Time 1: pick a date from Thu 2 Oct.");
  assert.equal(ptSlotDateProblem("2031-10-01", 1, window, SINGAPORE, PAST_MIDNIGHT_SYDNEY), null);
});

test("TEN-90 three days ahead counts calendar days across a Sydney daylight-saving start, not 72 hours", () => {
  // 01:00 on Sunday 4 October 2026, the morning the clocks go forward in Sydney.
  const now = Date.parse("2026-10-03T15:00:00.000Z");
  assert.deepEqual(ptWindowDates({ minDays: 3, maxDays: 3 }, SYDNEY, now), { earliest: "2026-10-07", latest: "2026-10-07" });
});

test("PT-122 the notice names the rule and the dates it allows today", () => {
  assert.equal(ptWindowNotice(window, SINGAPORE, NOW), "Choose dates 3 to 7 days from today (Wed 1 Oct – Sun 5 Oct).");
  assert.equal(ptWindowPhrase({ minDays: 1, maxDays: 14 }), "from tomorrow, up to 14 days ahead");
  assert.equal(ptWindowNotice({ minDays: 2, maxDays: 2 }, SINGAPORE, NOW), "Choose a date 2 days from today (Tue 30 Sep).");
  assert.equal(ptWindowNotice({ minDays: 1, maxDays: 1 }, SINGAPORE, NOW), "Choose a date 1 day from today (Mon 29 Sep).");
});

test("PT-122 a date outside the window is named in the member's words; one inside is fine", () => {
  assert.equal(ptSlotDateProblem("2031-09-30", 1, window, SINGAPORE, NOW), "Time 1: pick a date from Wed 1 Oct.");
  assert.equal(ptSlotDateProblem("2031-10-06", 2, window, SINGAPORE, NOW), "Time 2: pick a date up to Sun 5 Oct.");
  assert.equal(ptSlotDateProblem("2031-10-01", 1, window, SINGAPORE, NOW), null);
  assert.equal(ptSlotDateProblem("2031-10-05", 1, window, SINGAPORE, NOW), null);
});

test("PT-122 the server's date refusals read as the rule; other codes are left to the caller", () => {
  const line = "Private sessions are booked at least 3 days ahead, up to 7 days ahead. Change any time outside that.";
  assert.equal(ptWindowRefusal("slot_date_too_soon", window), line);
  assert.equal(ptWindowRefusal("slot_date_too_far", window), line);
  assert.equal(ptWindowRefusal("insufficient_pt_credit", window), null);
});
