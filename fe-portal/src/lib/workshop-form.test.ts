import test from "node:test";
import assert from "node:assert/strict";
import type { WorkshopDay } from "@/types";
import { cutoffFromInput, cutoffInputValue, dayFromApi, dayToApi, inferMode } from "./workshop-form";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";

// The runner's own zone is irrelevant: every instant is written in UTC and the
// studio's zone is passed in.

const day = (date: string): WorkshopDay => ({
  id: date,
  date,
  startTime: "09:00",
  endTime: "12:00",
  roomId: "r",
  capacity: { waitlist: 0, onlineBooking: 12, buffer: 0 },
});

test("TEN-132 a workshop day typed as a date and two times is saved at the studio's wall time, and read back as the same date and times", () => {
  const d = { date: "2026-08-12", startTime: "09:00", endTime: "12:00" };
  assert.deepEqual(dayToApi(SYDNEY, d), { starts_at: "2026-08-11T23:00:00.000Z", ends_at: "2026-08-12T02:00:00.000Z" });
  assert.deepEqual(dayToApi(SINGAPORE, d), { starts_at: "2026-08-12T01:00:00.000Z", ends_at: "2026-08-12T04:00:00.000Z" });
  for (const zone of [SYDNEY, SINGAPORE, "America/Los_Angeles"]) {
    const api = dayToApi(zone, d);
    assert.deepEqual(dayFromApi(zone, api.starts_at, api.ends_at), d, zone);
  }
  // A 00:30 day in Sydney belongs to the 12th there and was the evening of the 11th in Singapore.
  assert.deepEqual(dayFromApi(SYDNEY, "2026-08-11T14:30:00.000Z", "2026-08-11T16:00:00.000Z"), {
    date: "2026-08-12",
    startTime: "00:30",
    endTime: "02:00",
  });
  assert.deepEqual(dayFromApi(SINGAPORE, "2026-08-11T14:30:00.000Z", "2026-08-11T16:00:00.000Z"), {
    date: "2026-08-11",
    startTime: "22:30",
    endTime: "00:00",
  });
});

test("TEN-132 a workshop day on a Sydney daylight-saving change keeps its wall time", () => {
  // 09:00 the day before the clocks go forward (AEST) and the day of it (AEDT): an hour apart in UTC.
  const before = dayToApi(SYDNEY, { date: "2026-10-03", startTime: "09:00", endTime: "10:00" });
  const after = dayToApi(SYDNEY, { date: "2026-10-04", startTime: "09:00", endTime: "10:00" });
  assert.equal(before.starts_at, "2026-10-02T23:00:00.000Z");
  assert.equal(after.starts_at, "2026-10-03T22:00:00.000Z");
  assert.equal(dayFromApi(SYDNEY, after.starts_at, after.ends_at).startTime, "09:00");
});

test("TEN-133 an early-bird cutoff typed into the form is the studio's wall time, and shown as the same wall time", () => {
  // 18:00 on 12 August at the studio.
  assert.equal(cutoffFromInput(SYDNEY, "2026-08-12T18:00"), "2026-08-12T08:00:00.000Z");
  assert.equal(cutoffFromInput(SINGAPORE, "2026-08-12T18:00"), "2026-08-12T10:00:00.000Z");
  assert.equal(cutoffInputValue(SYDNEY, "2026-08-12T08:00:00.000Z"), "2026-08-12T18:00");
  assert.equal(cutoffInputValue(SINGAPORE, "2026-08-12T10:00:00.000Z"), "2026-08-12T18:00");
  // The same stored instant reads as a different wall time at another studio.
  assert.equal(cutoffInputValue(SINGAPORE, "2026-08-12T08:00:00.000Z"), "2026-08-12T16:00");
  for (const zone of [SYDNEY, SINGAPORE, "America/Los_Angeles"]) {
    assert.equal(cutoffInputValue(zone, cutoffFromInput(zone, "2026-12-01T07:45")), "2026-12-01T07:45", zone);
  }
  // A blank or half-typed field is no cutoff.
  assert.equal(cutoffFromInput(SYDNEY, ""), null);
  assert.equal(cutoffFromInput(SYDNEY, "2026-08-12"), null);
  assert.equal(cutoffInputValue(SYDNEY, null), "");
});

test("TEN-132 consecutive days are a Date range and any gap is Individual dates, across a month and a year end", () => {
  assert.equal(inferMode([]), "range");
  assert.equal(inferMode([day("2026-08-12")]), "range");
  assert.equal(inferMode([day("2026-08-13"), day("2026-08-12")]), "range");
  assert.equal(inferMode([day("2026-12-31"), day("2027-01-01")]), "range");
  assert.equal(inferMode([day("2026-10-03"), day("2026-10-04"), day("2026-10-05")]), "range");
  assert.equal(inferMode([day("2026-08-12"), day("2026-08-14")]), "individual");
});
