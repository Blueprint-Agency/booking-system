import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import {
  afterFailedRead,
  answeredElsewhere,
  combineReads,
  countOf,
  loadFailureSentence,
  mayDrawEmpty,
  READ_LOADING,
  readLoaded,
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

test("ADM-01 a 401 and a maintenance answer keep the screen waiting: the sign-in and the maintenance screen answer them", () => {
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

test("ADM-01 a list draws rows only once it loaded, and an empty state only for a loaded, empty answer", () => {
  assert.deepEqual(rowsOf(READ_LOADING), []);
  assert.deepEqual(rowsOf(FAILED), []);
  assert.deepEqual(rowsOf(readLoaded([1, 2])), [1, 2]);

  assert.equal(mayDrawEmpty(readLoaded([])), true);
  assert.equal(mayDrawEmpty(readLoaded([1])), false);
  assert.equal(mayDrawEmpty(FAILED), false);
  assert.equal(mayDrawEmpty(READ_LOADING), false);
});

test("ADM-01 a count is a number only once its read loaded: a failed or pending read is never 0", () => {
  assert.equal(countOf(readLoaded([])), 0);
  assert.equal(countOf(readLoaded(["a", "b", "c"])), 3);
  assert.equal(countOf(FAILED), null);
  assert.equal(countOf(READ_LOADING), null);
});

test("ADM-01 a screen drawn from several reads is failed if any failed, else loading if any is on its way", () => {
  assert.equal(combineReads(readLoaded(1), readLoaded(2)), "loaded");
  assert.equal(combineReads(readLoaded(1), READ_LOADING), "loading");
  assert.equal(combineReads(readLoaded(1), FAILED), "failed");
  assert.equal(combineReads(READ_LOADING, FAILED), "failed");
  assert.equal(combineReads(), "loaded");
});

test("ADM-01 a failure says what could not be loaded", () => {
  assert.equal(loadFailureSentence("the studio list"), "Couldn't load the studio list.");
});
