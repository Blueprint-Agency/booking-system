import test from "node:test";
import assert from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./avatar";

const PICTURE = "https://cdn.example.test/t/tenant/avatars/one.jpg";

test("STF-53 a person with a picture is shown by their picture", () => {
  const html = renderToStaticMarkup(createElement(Avatar, { name: "Mei Ling Tan", src: PICTURE }));
  assert.match(html, new RegExp(`<img[^>]+src="${PICTURE}"`));
  assert.doesNotMatch(html, />MT</);
});

test("STF-53 a person with no picture is shown by their initials", () => {
  for (const src of [null, undefined]) {
    const html = renderToStaticMarkup(createElement(Avatar, { name: "Mei Ling Tan", src }));
    assert.doesNotMatch(html, /<img/);
    assert.match(html, />ML</);
  }
});
