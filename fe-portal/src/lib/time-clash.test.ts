import test from "node:test";
import assert from "node:assert";
import { ApiError } from "./api";
import { timeClashOf, timeClashPrompt, timeClashRefusal, withClashConfirm } from "./time-clash";

// 08:00 UTC is 4:00 pm in Singapore.
const refusal = (kind: "class" | "pt" | "workshop" = "class") =>
  new ApiError(409, {
    error: "time_clash",
    client_id: "c1",
    client_name: "Ana Lim",
    clash: {
      booking_id: "b1",
      kind,
      title: kind === "pt" ? "Private session" : "Inversion",
      starts_at: "2026-09-30T08:00:00.000Z",
      ends_at: "2026-09-30T09:00:00.000Z",
      location_name: "Riverside",
    },
  });

test("BKG-43 staff are warned whose booking a class clashes with, in the studio's time", () => {
  const t = timeClashOf(refusal())!;
  assert.equal(
    timeClashPrompt(t, "class"),
    "Ana Lim is already booked into Inversion at 4:00 pm (Riverside), which overlaps this class. Book anyway?",
  );
  assert.equal(timeClashRefusal(t), "Not booked: Ana Lim is already booked into Inversion at 4:00 pm (Riverside) at the same time.");
});

test("PT-124 a private session in the way is named as one, and the warning ends on the session", () => {
  assert.equal(
    timeClashPrompt(timeClashOf(refusal("pt"))!, "session"),
    "Ana Lim is already booked into a private session at 4:00 pm (Riverside), which overlaps this session. Book anyway?",
  );
});

test("BKG-43 only a time_clash is read as one", () => {
  assert.equal(timeClashOf(new ApiError(409, { error: "class_full" })), null);
  assert.equal(timeClashOf(new Error("x")), null);
});

test("BKG-43 confirmed, the request runs again with allow_clash; declined, the refusal stands", async () => {
  const calls: unknown[] = [];
  const run = async (extra: { allow_clash?: true }) => {
    calls.push(extra);
    if (!extra.allow_clash) throw refusal();
    return "booked";
  };
  assert.equal(await withClashConfirm("class", run, () => true), "booked");
  assert.deepEqual(calls, [{}, { allow_clash: true }]);

  calls.length = 0;
  await assert.rejects(withClashConfirm("class", run, () => false), (e) => timeClashOf(e) !== null);
  assert.deepEqual(calls, [{}]);

  // Any other refusal is not asked about.
  let asked = false;
  await assert.rejects(
    withClashConfirm("class", async () => { throw new ApiError(409, { error: "class_full" }); }, () => (asked = true)),
  );
  assert.equal(asked, false);
});
