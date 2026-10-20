import test from "node:test";
import assert from "node:assert/strict";
import {
  mappableLocations,
  outcomeRows,
  overbookedHeadline,
  gmailConfirmationHref,
  ROSTER_DIFFERENCE_LABELS,
  setupGuide,
  type ClassPassSetup,
} from "./classpass";

/** A studio that has done nothing yet. */
const NOTHING_DONE: ClassPassSetup = {
  enabled: false,
  gmail_confirmation_received: false,
  gmail_confirmation_at: null,
  first_classpass_email_at: null,
  location_mappings: 0,
  unmapped_location_reviews: 0,
  first_classpass_booking_at: null,
};

const EVERYTHING_DONE: ClassPassSetup = {
  enabled: true,
  gmail_confirmation_received: true,
  gmail_confirmation_at: "2026-10-01T02:00:00Z",
  first_classpass_email_at: "2026-10-02T00:05:00Z",
  location_mappings: 2,
  unmapped_location_reviews: 0,
  first_classpass_booking_at: "2026-10-03T09:00:00Z",
};

const states = (setup: ClassPassSetup) => setupGuide(setup).steps.map((s) => [s.key, s.state]);

test("CPS-109 the setup guide's five steps start with turning the import on as the current one, and the rest still to come", () => {
  const guide = setupGuide(NOTHING_DONE);
  assert.deepEqual(states(NOTHING_DONE), [
    ["enable", "current"],
    ["forwarding", "upcoming"],
    ["filter", "upcoming"],
    ["locations", "upcoming"],
    ["test_booking", "upcoming"],
  ]);
  assert.equal(guide.current, "enable");
  assert.equal(guide.complete, false);
  assert.equal(guide.poll, true);
});

test("CPS-109 each step ticks on its own fact, and the current step is the first not yet done", () => {
  assert.deepEqual(states({ ...NOTHING_DONE, enabled: true }), [
    ["enable", "done"],
    ["forwarding", "current"],
    ["filter", "upcoming"],
    ["locations", "upcoming"],
    ["test_booking", "upcoming"],
  ]);
  // Gmail's code has arrived and ClassPass's first email too; the import is still off.
  const outOfOrder = {
    ...NOTHING_DONE,
    gmail_confirmation_received: true,
    gmail_confirmation_at: "2026-10-01T02:00:00Z",
    first_classpass_email_at: "2026-10-02T00:05:00Z",
  };
  assert.deepEqual(states(outOfOrder), [
    ["enable", "current"],
    ["forwarding", "done"],
    ["filter", "done"],
    ["locations", "upcoming"],
    ["test_booking", "upcoming"],
  ]);
  assert.equal(setupGuide(outOfOrder).current, "enable");
  assert.deepEqual(states({ ...EVERYTHING_DONE, first_classpass_booking_at: null }).at(-1), ["test_booking", "current"]);
});

test("CPS-110 the location step is done only with a mapping and no review item waiting on an unmapped location", () => {
  const upToLocations = { ...EVERYTHING_DONE, first_classpass_booking_at: null };
  const locations = (setup: ClassPassSetup) => setupGuide(setup).steps.find((s) => s.key === "locations")?.done;
  assert.equal(locations({ ...upToLocations, location_mappings: 0 }), false);
  assert.equal(locations({ ...upToLocations, location_mappings: 1, unmapped_location_reviews: 1 }), false);
  assert.equal(locations({ ...upToLocations, location_mappings: 1, unmapped_location_reviews: 0 }), true);
  assert.equal(setupGuide({ ...upToLocations, location_mappings: 0 }).current, "locations");
});

test("CPS-112 the page offers Gmail's confirmation link to open only when it leads to Gmail's forwarding settings", () => {
  const link = "https://mail-settings.google.com/mail/vf-%5BANGjdJ8_x%5D-y";
  assert.equal(gmailConfirmationHref(link), link);
  assert.equal(gmailConfirmationHref(null), null);
  assert.equal(gmailConfirmationHref("https://mail-settings.google.com.example/mail/vf-x"), null);
  assert.equal(gmailConfirmationHref("http://mail-settings.google.com/mail/vf-x"), null);
  assert.equal(gmailConfirmationHref("javascript:alert(1)"), null);
});

test("CPS-111 with every step done the guide is complete, has no current step, and stops asking for news", () => {
  const guide = setupGuide(EVERYTHING_DONE);
  assert.ok(guide.steps.every((s) => s.done && s.state === "done"));
  assert.equal(guide.current, null);
  assert.equal(guide.complete, true);
  assert.equal(guide.poll, false);
});

test("CPS-28 the mapping editor offers the studio's live Locations by name, never an archived one", () => {
  const offered = mappableLocations([
    { id: "b", name: "Harbour", archivedAt: null },
    { id: "a", name: "Annex", archivedAt: "2026-01-01T00:00:00Z" },
    { id: "c", name: "Bay", archivedAt: null },
  ]);
  assert.deepEqual(offered, [
    { id: "c", name: "Bay" },
    { id: "b", name: "Harbour" },
  ]);
});

test("the import status lists every outcome, a missing one as 0, and totals them", () => {
  const { rows, total } = outcomeRows({ ignored: 4, refused: 1 });
  assert.equal(rows.length, 7);
  assert.equal(rows.find((r) => r.outcome === "ignored")?.count, 4);
  assert.equal(rows.find((r) => r.outcome === "refused")?.count, 1);
  assert.equal(rows.find((r) => r.outcome === "imported")?.count, 0);
  assert.equal(total, 5);
});

test("CPS-36 the ClassPass page flags ClassPass bookings that took an Overbook seat, counting them", () => {
  const one = {
    booking_id: "b1",
    class_id: "c1",
    class_name: "Yoga Stretch",
    starts_at: "2026-09-18T05:30:00Z",
    client_name: "Placeholder Member",
  };
  assert.equal(overbookedHeadline([one]), "1 ClassPass booking took an Overbook seat on an upcoming class.");
  assert.equal(
    overbookedHeadline([one, { ...one, booking_id: "b2" }]),
    "2 ClassPass bookings took an Overbook seat on upcoming classes.",
  );
});

test("CPS-81, CPS-82 the ClassPass page names each roster difference by where the member is and isn't", () => {
  assert.equal(ROSTER_DIFFERENCE_LABELS.on_classpass_not_on_roster, "On ClassPass, not on roster");
  assert.equal(ROSTER_DIFFERENCE_LABELS.on_roster_not_on_classpass, "On roster, not on ClassPass");
});
