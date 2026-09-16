import test from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const STAGING = {
  apiUrl: "https://api.dev.reservetoday.app/api/v1",
  sentryDsn: "https://abc123@o42.ingest.us.sentry.io/7",
  dev: false,
};

const header = (name: string, input = STAGING) =>
  securityHeaders(input).find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;

/** `directive → sources` from a policy string. */
const directives = (policy: string) =>
  new Map(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name!, sources]),
  );

test("every page carries the fixed hardening headers", () => {
  assert.match(header("Strict-Transport-Security")!, /max-age=\d{8,}; includeSubDomains/);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.match(header("Permissions-Policy")!, /camera=\(\)/);
  assert.ok(header("Content-Security-Policy"), "enforced, not report-only");
});

test("the policy lets the page reach the API and Sentry, and nothing else", () => {
  const csp = directives(contentSecurityPolicy(STAGING));
  assert.deepEqual(csp.get("connect-src"), [
    "'self'",
    "https://api.dev.reservetoday.app",
    "https://o42.ingest.us.sentry.io",
  ]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'self'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.ok(!csp.get("script-src")!.includes("'unsafe-eval'"), "no eval outside dev");
});

test("no Sentry DSN, no Sentry origin; a bad DSN is not a crash", () => {
  for (const sentryDsn of [undefined, "", "not a url"]) {
    const csp = directives(contentSecurityPolicy({ ...STAGING, sentryDsn }));
    assert.deepEqual(csp.get("connect-src"), ["'self'", "https://api.dev.reservetoday.app"]);
  }
});

test("local dev reaches the local API and allows the dev server's eval", () => {
  const csp = directives(contentSecurityPolicy({ apiUrl: undefined, sentryDsn: undefined, dev: true }));
  assert.deepEqual(csp.get("connect-src"), ["'self'", "http://localhost:4000"]);
  assert.ok(csp.get("script-src")!.includes("'unsafe-eval'"));
});
