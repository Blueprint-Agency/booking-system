import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarStamp, googleCalendarUrl, icsFile, icsFileName, type CalendarEvent } from "./add-to-calendar.ts";

const event: CalendarEvent = {
  uid: "booking-b1@example.test",
  title: "Slow Flow at Northwind",
  startsAt: "2026-09-28T01:00:00.000Z",
  endsAt: "2026-09-28T02:15:00.000Z",
  location: "Harbour Studio, 1 Quay Rd; Level 2",
  details: "Booked with Northwind.\nManage it at https://northwind.example.test/account/classes",
};

test("a time is written in UTC, with no separators or milliseconds", () => {
  assert.equal(calendarStamp("2026-09-28T01:00:00.000Z"), "20260928T010000Z");
  assert.equal(calendarStamp("2026-09-28T09:00:00+08:00"), "20260928T010000Z");
});

test("the Google link prefills title, times, place and details", () => {
  const url = new URL(googleCalendarUrl(event));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), event.title);
  assert.equal(url.searchParams.get("dates"), "20260928T010000Z/20260928T021500Z");
  assert.equal(url.searchParams.get("location"), event.location);
  assert.equal(url.searchParams.get("details"), event.details);
});

test("a class with no place leaves the Google location out", () => {
  const url = new URL(googleCalendarUrl({ ...event, location: null }));
  assert.equal(url.searchParams.has("location"), false);
});

test("the .ics file is one VEVENT, CRLF-ended, with a reminder an hour before", () => {
  const ics = icsFile(event, new Date("2026-09-27T12:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.split("\n").every((l) => l === "" || l.endsWith("\r")), true);
  assert.match(ics, /\r\nUID:booking-b1@example\.test\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20260927T120000Z\r\n/);
  assert.match(ics, /\r\nDTSTART:20260928T010000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260928T021500Z\r\n/);
  assert.match(ics, /\r\nTRIGGER:-PT1H\r\n/);
});

test("text values escape commas, semicolons and newlines", () => {
  const ics = icsFile(event).replace(/\r\n /g, "");
  assert.match(ics, /LOCATION:Harbour Studio\\, 1 Quay Rd\\; Level 2\r\n/);
  assert.match(ics, /DESCRIPTION:Booked with Northwind\.\\nManage it at /);
});

test("a long line is folded at 75 octets without splitting a character", () => {
  const title = "Yin ".repeat(10) + "瑜伽".repeat(20);
  const ics = icsFile({ ...event, title });
  const encoder = new TextEncoder();
  for (const line of ics.split("\r\n")) assert.ok(encoder.encode(line).length <= 75, line);
  assert.match(ics.replace(/\r\n /g, ""), new RegExp(`SUMMARY:${title}\r\n`));
});

test("the file name is the title, made safe", () => {
  assert.equal(icsFileName("Slow Flow at Northwind"), "slow-flow-at-northwind.ics");
  assert.equal(icsFileName("瑜伽"), "class.ics");
});
