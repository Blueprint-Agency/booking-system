import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { maintenanceMessage, noteMaintenance, onMaintenance } from "./maintenance";

afterEach(() => onMaintenance(null));

const MAINTENANCE = { error: "maintenance", message: "Upgrading. Back by 10pm." };

test("SUP-30 a 503 maintenance answer carries the platform's message", () => {
  assert.equal(maintenanceMessage(503, MAINTENANCE), "Upgrading. Back by 10pm.");
});

test("SUP-30 a 503 maintenance answer with no usable message gets the default wording", () => {
  assert.equal(maintenanceMessage(503, { error: "maintenance" }), "Maintenance in progress. We'll be back shortly.");
  assert.equal(maintenanceMessage(503, { error: "maintenance", message: "  " }), "Maintenance in progress. We'll be back shortly.");
});

test("SUP-30 anything else is not maintenance: another 503, another status, no body", () => {
  assert.equal(maintenanceMessage(503, { error: "internal_error" }), null);
  assert.equal(maintenanceMessage(503, "Service Unavailable"), null);
  assert.equal(maintenanceMessage(503, null), null);
  assert.equal(maintenanceMessage(500, MAINTENANCE), null);
  assert.equal(maintenanceMessage(404, MAINTENANCE), null);
});

test("SUP-30 noting a maintenance answer tells the app, with the message; anything else does not", () => {
  const seen: string[] = [];
  onMaintenance(message => seen.push(message));
  assert.equal(noteMaintenance(404, { error: "not_found" }), false);
  assert.equal(noteMaintenance(503, MAINTENANCE), true);
  assert.deepEqual(seen, ["Upgrading. Back by 10pm."]);
});
