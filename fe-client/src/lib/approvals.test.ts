import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalAccountPath, approvalEvent, approvalName, type ApiApproval } from "./approvals.ts";

const approval = (over: Partial<ApiApproval> = {}): ApiApproval => ({
  kind: "pt",
  id: "r1",
  title: "Private session",
  session_type: "1on1",
  starts_at: "2026-10-01T02:00:00.000Z",
  ends_at: "2026-10-01T03:00:00.000Z",
  location_name: "Harbour Studio",
  location_address: "1 Quay Rd",
  location_gmaps_url: "https://maps.example.test/harbour",
  instructor_name: "Sam",
  approved_at: "2026-09-28T01:00:00.000Z",
  ...over,
});

test("a PT approval is named by its class type and session type; a corporate one by its package", () => {
  assert.equal(approvalName(approval()), "Private session (1-on-1)");
  assert.equal(approvalName(approval({ title: "Yin", session_type: "2on1" })), "Yin · private 2-on-1");
  assert.equal(approvalName(approval({ kind: "corporate", title: "Team Offsite", session_type: null })), "Team Offsite");
});

test("each kind links to its own account page", () => {
  assert.equal(approvalAccountPath("pt"), "/account/private-sessions");
  assert.equal(approvalAccountPath("corporate"), "/account/corporate");
});

test("the calendar event carries the session's time, place and instructor", () => {
  const event = approvalEvent(approval(), "Northwind", { uid: "u", accountUrl: "https://x.test/account/private-sessions" });
  assert.equal(event.title, "Private session (1-on-1) at Northwind");
  assert.equal(event.startsAt, "2026-10-01T02:00:00.000Z");
  assert.equal(event.endsAt, "2026-10-01T03:00:00.000Z");
  assert.equal(event.location, "Harbour Studio, 1 Quay Rd");
  assert.match(event.details, /with Sam\./);
  assert.match(event.details, /Directions: https:\/\/maps\.example\.test\/harbour/);
  assert.match(event.details, /Manage it: https:\/\/x\.test\/account\/private-sessions/);
  const offsite = approvalEvent(approval({ location_name: null, location_address: null, location_gmaps_url: null, instructor_name: null }), "Northwind", {
    uid: "u",
    accountUrl: null,
  });
  assert.equal(offsite.location, null);
  assert.doesNotMatch(offsite.details, /Manage it/);
  assert.doesNotMatch(offsite.details, /Directions/);
});
