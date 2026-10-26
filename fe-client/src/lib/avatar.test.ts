import test from "node:test";
import assert from "node:assert/strict";
import { avatarFace, initialsOf } from "./avatar.ts";

test("ACC-60 a person with a picture is shown by it, with their initials kept for when it cannot load", () => {
  assert.deepEqual(
    avatarFace({ name: "Ada Lovelace", photoUrl: "https://cdn.example/t/1/avatars/a.webp" }),
    { kind: "photo", src: "https://cdn.example/t/1/avatars/a.webp", initials: "AL" },
  );
});

test("ACC-60 a person without a picture, or whose picture was removed, is shown by their initials", () => {
  assert.deepEqual(avatarFace({ name: "Ada Lovelace", photoUrl: null }), { kind: "initials", initials: "AL" });
  assert.deepEqual(avatarFace({ name: "Ada Lovelace", photoUrl: "" }), { kind: "initials", initials: "AL" });
  assert.deepEqual(avatarFace({ name: "Ada Lovelace" }), { kind: "initials", initials: "AL" });
});

test("ACC-60 initials are the first letters of the first and last names, capitalised", () => {
  assert.equal(initialsOf("ada lovelace"), "AL");
  assert.equal(initialsOf("Mary Ann Smith"), "MS");
  assert.equal(initialsOf("  Ada   "), "A");
});

test("ACC-60 a member with no name yet is shown by the first letter of their email", () => {
  assert.equal(initialsOf("", "zed@example.test"), "Z");
  assert.deepEqual(avatarFace({ name: " ", email: "zed@example.test", photoUrl: null }), {
    kind: "initials",
    initials: "Z",
  });
});
