import test from "node:test";
import assert from "node:assert/strict";
import { describeDevice } from "./user-agent";

test("a desktop browser is named with its system", () => {
  assert.equal(
    describeDevice(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ),
    "Chrome on macOS",
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    "Firefox on Windows",
  );
  assert.equal(
    describeDevice(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    ),
    "Edge on Windows",
  );
});

test("a phone is named with its system, and Safari is not mistaken for Chrome", () => {
  assert.equal(
    describeDevice(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
    "Safari on iPhone",
  );
  assert.equal(
    describeDevice(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    ),
    "Chrome on Android",
  );
});

test("an unrecognised or missing agent says so rather than guessing", () => {
  assert.equal(describeDevice(null), "Unknown device");
  assert.equal(describeDevice(""), "Unknown device");
  assert.equal(describeDevice("curl/8.4.0"), "Unknown browser");
});
