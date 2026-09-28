import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarLocation, calendarStamp, directionsLine, googleCalendarUrl, type CalendarEvent } from "./add-to-calendar.ts";

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

test("the place is the Location's name and street address, and nothing without a name", () => {
  assert.equal(calendarLocation("Harbour Studio", "1 Quay Rd"), "Harbour Studio, 1 Quay Rd");
  assert.equal(calendarLocation("Harbour Studio", null), "Harbour Studio");
  assert.equal(calendarLocation(null, "1 Quay Rd"), null);
});

test("the Location's map link rides in the details, when it has one", () => {
  assert.equal(directionsLine("https://maps.example.test/harbour"), "Directions: https://maps.example.test/harbour");
  assert.equal(directionsLine(null), null);
});

