import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import {
  afterFailedRead,
  answeredElsewhere,
  failureDetail,
  loadFailureSentence,
  READ_LOADING,
  readLoaded,
  reportableFailure,
  rowsOf,
  type ReadState,
} from "./failed-read";

const FAILED: ReadState<never> = { status: "failed" };

test("ADM-01 a read that failed with a 500, a 404 or no answer at all settles as failed, never as data", () => {
  assert.deepEqual(afterFailedRead(new ApiError(500, { error: "internal_error" })), FAILED);
  assert.deepEqual(afterFailedRead(new ApiError(502, null)), FAILED);
  assert.deepEqual(afterFailedRead(new ApiError(404, { error: "not_found" })), FAILED);
  assert.deepEqual(afterFailedRead(new TypeError("Failed to fetch")), FAILED);
  assert.deepEqual(afterFailedRead(new DOMException("timed out", "TimeoutError")), FAILED);
});

test("ADM-01 a 401 and a maintenance answer keep the screen waiting: the session ending and the maintenance screen replace it", () => {
  assert.deepEqual(afterFailedRead(new ApiError(401, { error: "unauthorized" })), READ_LOADING);
  assert.deepEqual(
    afterFailedRead(new ApiError(503, { error: "maintenance", message: "Back at 10pm." })),
    READ_LOADING,
  );
  assert.equal(answeredElsewhere(new ApiError(401, null)), true);
  assert.equal(answeredElsewhere(new ApiError(503, { error: "maintenance" })), true);
});

test("ADM-01 a 403 or any other 503 is a failure to show, not one answered elsewhere", () => {
  assert.equal(answeredElsewhere(new ApiError(403, { error: "forbidden_permission" })), false);
  assert.equal(answeredElsewhere(new ApiError(503, { error: "internal_error" })), false);
  assert.equal(answeredElsewhere(new Error("boom")), false);
  assert.equal(answeredElsewhere(null), false);
});

test("ADM-01 a list draws rows only once it loaded", () => {
  assert.deepEqual(rowsOf(READ_LOADING), []);
  assert.deepEqual(rowsOf(FAILED), []);
  assert.deepEqual(rowsOf(readLoaded([1, 2])), [1, 2]);
});

test("ADM-01 a failure says what could not be loaded", () => {
  assert.equal(loadFailureSentence("the studio list"), "Couldn't load the studio list.");
});

test("ADM-01 a failure carries the backend's reason only when it is a refusal with words, never for a server fault", () => {
  assert.equal(
    failureDetail(new ApiError(403, { error: "forbidden_permission", message: "ignored" })),
    "You do not have permission for this. Ask an admin.",
  );
  assert.equal(failureDetail(new ApiError(403, { error: "forbidden", message: "Not yours." })), "Not yours.");
  assert.equal(failureDetail(new ApiError(500, { error: "internal_error", message: "Boom." })), undefined);
  assert.equal(failureDetail(new ApiError(404, null)), undefined);
  assert.equal(failureDetail(new TypeError("Failed to fetch")), undefined);
});

test("ADM-01 a failed read is reported once: a 5xx or a network failure was already reported by the request, and a 401 or maintenance is not a fault", () => {
  assert.equal(reportableFailure(new ApiError(500, null)), false);
  assert.equal(reportableFailure(new ApiError(502, null)), false);
  assert.equal(reportableFailure(new TypeError("Failed to fetch")), false);
  assert.equal(reportableFailure(new DOMException("timed out", "TimeoutError")), false);
  assert.equal(reportableFailure(new ApiError(401, null)), false);
  assert.equal(reportableFailure(new ApiError(503, { error: "maintenance" })), false);
});

test("ADM-01 a 4xx the request does not report, and an error the screen itself threw, are reported", () => {
  assert.equal(reportableFailure(new ApiError(404, { error: "not_found" })), true);
  assert.equal(reportableFailure(new ApiError(403, { error: "forbidden_permission" })), true);
  assert.equal(reportableFailure(new Error("cannot read properties of undefined")), true);
});
