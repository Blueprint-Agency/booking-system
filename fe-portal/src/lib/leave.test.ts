import { test } from "node:test";
import assert from "node:assert/strict";
import { instructorOptionLabel, supportingDocumentAction, type LeaveStatus, type LeaveType } from "./leave";

const request = (type: LeaveType, status: LeaveStatus, has_supporting_document = false) => ({
  type,
  status,
  has_supporting_document,
});

test("LEV-142 Attach document is offered on a pending or approved medical or study request, and on no closed one", () => {
  for (const type of ["medical", "study"] as const) {
    for (const status of ["pending", "approved"] as const) {
      assert.equal(supportingDocumentAction(request(type, status)), "attach", `${type} ${status}`);
    }
    for (const status of ["rejected", "withdrawn", "cancelled", "revoked"] as const) {
      assert.equal(supportingDocumentAction(request(type, status)), null, `${type} ${status}`);
    }
  }
});

test("LEV-142 a document already attached can still be opened, whatever the request's status", () => {
  const statuses = ["pending", "approved", "rejected", "withdrawn", "cancelled", "revoked"] as const;
  for (const status of statuses) {
    assert.equal(supportingDocumentAction(request("medical", status, true)), "open", status);
  }
});

test("LEV-142 annual leave offers no document at all", () => {
  assert.equal(supportingDocumentAction(request("annual", "pending")), null);
  assert.equal(supportingDocumentAction(request("annual", "approved")), null);
});

test("ADM-09 an instructor picker whose leave read failed says leave was not checked, and never reads as nobody being away", () => {
  assert.equal(instructorOptionLabel("Mei", undefined, true), "Mei — leave not checked");
  assert.equal(instructorOptionLabel("Mei", undefined, false), "Mei");
});

test("ADM-09 an instructor who is known to be away is labelled so, checked or not", () => {
  assert.equal(instructorOptionLabel("Mei", "none", false), "Mei — On leave");
  assert.equal(instructorOptionLabel("Mei", "morning", false), "Mei — On leave (AM)");
  assert.equal(instructorOptionLabel("Mei", "afternoon", true), "Mei — On leave (PM)");
});
