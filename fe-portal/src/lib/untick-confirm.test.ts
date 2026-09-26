import test from "node:test";
import assert from "node:assert/strict";
import { untickConfirmCopy } from "./untick-confirm";

test("unticking names the member and says the credit stays spent", () => {
  assert.deepEqual(untickConfirmCopy("Ada Lovelace"), {
    title: "Unmark Ada Lovelace as attended?",
    body: "Their check-in is removed. The credit stays spent — to return it, cancel the booking afterwards.",
    keep: "Keep attended",
    confirm: "Unmark",
  });
});
