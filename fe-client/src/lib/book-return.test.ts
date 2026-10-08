import test from "node:test";
import assert from "node:assert/strict";
import { bookSignInPath, classToBook } from "./book-return.ts";
import { safeNextPath } from "./auth-redirect.ts";

const CLASS_ID = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

/** The `next` a sign-in link carries, as the login page reads it. */
const nextOf = (href: string) => safeNextPath(new URL(href, "http://acme.localhost:3000").searchParams);

test("CAT-06 a signed-out Book Now signs in with the class it was for as next", () => {
  assert.equal(nextOf(bookSignInPath(CLASS_ID)), `/?book=${CLASS_ID}`);
});

test("CAT-06 the schedule reads the class to book back from its own address", () => {
  const next = nextOf(bookSignInPath(CLASS_ID))!;
  assert.equal(classToBook(new URL(next, "http://acme.localhost:3000").searchParams), CLASS_ID);
});

test("the schedule opens nothing without a class to book", () => {
  assert.equal(classToBook(new URLSearchParams("")), null);
});

test("anything that is not a class id is ignored rather than looked up", () => {
  assert.equal(classToBook(new URLSearchParams("book=")), null);
  assert.equal(classToBook(new URLSearchParams("book=../../account")), null);
  assert.equal(classToBook(new URLSearchParams(`book=${CLASS_ID}x`)), null);
});
