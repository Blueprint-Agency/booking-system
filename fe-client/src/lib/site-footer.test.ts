import test from "node:test";
import assert from "node:assert/strict";
import { footerLinks } from "./site-footer.ts";

test("CAT-07 the footer links only what the studio set, legal links before social ones", () => {
  assert.deepEqual(
    footerLinks({
      "social.instagram": "https://instagram.example/studio",
      "legal.privacy_url": "https://studio.example/privacy",
      "legal.terms_url": "https://studio.example/terms",
      "contact.whatsapp": "6580000000",
    }),
    {
      legal: [
        { label: "Terms", href: "https://studio.example/terms" },
        { label: "Privacy", href: "https://studio.example/privacy" },
      ],
      social: [{ label: "Instagram", href: "https://instagram.example/studio" }],
    },
  );
});

test("CAT-07 a studio that set no links gets none, and no stand-in of the platform's", () => {
  assert.deepEqual(footerLinks({}), { legal: [], social: [] });
});

test("a blank or non-web value is left out rather than linked", () => {
  assert.deepEqual(
    footerLinks({
      "legal.terms_url": "   ",
      "legal.privacy_url": "javascript:alert(1)",
      "social.facebook": "facebook.com/studio",
      "social.instagram": " https://instagram.example/studio ",
    }),
    { legal: [], social: [{ label: "Instagram", href: "https://instagram.example/studio" }] },
  );
});
