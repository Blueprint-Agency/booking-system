import test from "node:test";
import assert from "node:assert";
import {
  currentHourTime,
  formatDate,
  formatDateTime,
  formatPlainDay,
  formatTime,
  isFilterDay,
  todayIso,
} from "./formatters";

const SYDNEY = "Australia/Sydney";
const SINGAPORE = "Asia/Singapore";

// FIN-58: a date input fires `input` with year 0001, or 0002 and 0020 on the
// way to typing 2026, whatever its `min` says; none of them may reach the API.
test("FIN-58 a day in the filter is a real four-digit-year day no earlier than 1900", () => {
  assert.equal(isFilterDay("2026-10-30"), true);
  assert.equal(isFilterDay("1900-01-01"), true);
  assert.equal(isFilterDay("9999-12-31"), true);
});

test("FIN-58 the years a browser passes through while one is typed are not filter days", () => {
  for (const partial of ["0001-01-01", "0002-10-30", "0020-10-30", "0202-10-30", "1899-12-31"]) {
    assert.equal(isFilterDay(partial), false, partial);
  }
});

test("FIN-58 an empty or six-digit-year value is not a filter day", () => {
  assert.equal(isFilterDay(""), false);
  assert.equal(isFilterDay("275760-09-13"), false);
});

test("TEN-125 every date and time the portal prints is the studio's, whatever zone the browser is in", () => {
  // 00:30 on Wednesday 12 August in Sydney; 22:30 on Tuesday the 11th in Singapore.
  const at = "2026-08-11T14:30:00.000Z";
  assert.equal(formatDate(SYDNEY, at), "Wed 12 Aug");
  assert.equal(formatDate(SINGAPORE, at), "Tue 11 Aug");
  assert.equal(formatTime(SYDNEY, at), "12:30am");
  assert.equal(formatTime(SINGAPORE, at), "10:30pm");
  assert.equal(formatDateTime(SYDNEY, at), "Wed 12 Aug, 12:30am");
  assert.equal(formatDateTime(SINGAPORE, at), "Tue 11 Aug, 10:30pm");
  assert.equal(formatDate(SYDNEY, at, "d MMM yyyy"), "12 Aug 2026");
  assert.equal(formatDate(SYDNEY, at, "EEE h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase()), "Wed 12:30am");
});

test("TEN-125 a plain day (a birthday, a date column) reads as the day it names in every zone, and is never moved by one", () => {
  for (const zone of [SYDNEY, SINGAPORE, "America/Los_Angeles", "UTC"]) {
    assert.equal(formatDate(zone, "2000-05-01", "d MMM yyyy"), "1 May 2000", zone);
    assert.equal(formatDate(zone, "2026-10-01"), "Thu 1 Oct", zone);
  }
  assert.equal(formatPlainDay("2026-10-01"), "Thu 1 Oct");
  assert.equal(formatPlainDay("2026-12-31", "d MMM yyyy"), "31 Dec 2026");
});

test("TEN-125 today's date and the hour a time field starts on are the studio's", () => {
  // Today is read on the studio's clock: 00:30 on the 12th in Sydney is still the 11th in Singapore.
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-08-11T14:30:00.000Z");
  try {
    assert.equal(todayIso(SYDNEY), "2026-08-12");
    assert.equal(todayIso(SINGAPORE), "2026-08-11");
    // The top of the studio's hour, optionally some whole hours on, wrapping past midnight.
    assert.equal(currentHourTime(SYDNEY), "00:00");
    assert.equal(currentHourTime(SYDNEY, 1), "01:00");
    assert.equal(currentHourTime(SINGAPORE), "22:00");
    assert.equal(currentHourTime(SINGAPORE, 1), "23:00");
    assert.equal(currentHourTime(SINGAPORE, 2), "00:00");
  } finally {
    Date.now = realNow;
  }
});
