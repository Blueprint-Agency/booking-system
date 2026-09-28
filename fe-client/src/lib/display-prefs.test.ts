import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISPLAY_PREFS,
  DISPLAY_PREFS_KEY,
  DISPLAY_PREFS_SCRIPT,
  fromAccountDisplayPrefs,
  parseDisplayPrefs,
} from "./display-prefs.ts";

test("a member who has never chosen gets light theme and small text", () => {
  assert.deepEqual(parseDisplayPrefs(null), { theme: "light", fontSize: "small" });
  assert.deepEqual(DEFAULT_DISPLAY_PREFS, { theme: "light", fontSize: "small" });
});

test("a stored choice is read back", () => {
  assert.deepEqual(parseDisplayPrefs(JSON.stringify({ theme: "dark", fontSize: "large" })), {
    theme: "dark",
    fontSize: "large",
  });
});

test("an unrecognised value falls back field by field", () => {
  assert.deepEqual(parseDisplayPrefs(JSON.stringify({ theme: "sepia", fontSize: "medium" })), {
    theme: "light",
    fontSize: "medium",
  });
  assert.deepEqual(parseDisplayPrefs(JSON.stringify({ theme: "dark", fontSize: 18 })), {
    theme: "dark",
    fontSize: "small",
  });
});

test("unreadable storage is the default, not an error", () => {
  assert.deepEqual(parseDisplayPrefs("{not json"), DEFAULT_DISPLAY_PREFS);
  assert.deepEqual(parseDisplayPrefs("null"), DEFAULT_DISPLAY_PREFS);
  assert.deepEqual(parseDisplayPrefs('"dark"'), DEFAULT_DISPLAY_PREFS);
});

// The head script cannot import the parser, so it is run here against the same
// inputs to hold the two in step.
function runHeadScript(stored: string | null): Record<string, string> {
  const dataset: Record<string, string> = {};
  const store = new Map(stored === null ? [] : [[DISPLAY_PREFS_KEY, stored]]);
  const localStorage = { getItem: (k: string) => store.get(k) ?? null };
  const document = { documentElement: { dataset } };
  new Function("localStorage", "document", DISPLAY_PREFS_SCRIPT)(localStorage, document);
  return dataset;
}

test("the head script applies a stored choice before first paint", () => {
  assert.deepEqual(runHeadScript(JSON.stringify({ theme: "dark", fontSize: "medium" })), {
    theme: "dark",
    fontSize: "medium",
  });
});

test("the head script leaves the page alone on nothing, junk or an unknown value", () => {
  assert.deepEqual(runHeadScript(null), {});
  assert.deepEqual(runHeadScript("{not json"), {});
  assert.deepEqual(runHeadScript(JSON.stringify({ theme: "sepia", fontSize: "huge" })), {});
});

test("the account's choice is adopted field by field, and what it has not chosen is left to the device", () => {
  assert.deepEqual(fromAccountDisplayPrefs({ theme: "dark", font_size: "large" }), {
    theme: "dark",
    fontSize: "large",
  });
  assert.deepEqual(fromAccountDisplayPrefs({ theme: null, font_size: "medium" }), { fontSize: "medium" });
  assert.deepEqual(fromAccountDisplayPrefs({ theme: "sepia", font_size: null }), {});
  assert.deepEqual(fromAccountDisplayPrefs(undefined), {});
});
