import test from "node:test";
import assert from "node:assert/strict";
import { memberAuthMessage } from "./auth-messages.ts";

const FALLBACK = "Something went wrong.";

test("a blocked member is told to contact the studio, not to retry", () => {
  const message = memberAuthMessage({ status: 403, message: "client_blocked" }, FALLBACK);
  assert.match(message, /contact the studio/i);
});

test("a wrong or expired code says so", () => {
  assert.match(memberAuthMessage({ status: 400, code: "INVALID_OTP" }, FALLBACK), /code is incorrect/i);
  assert.match(memberAuthMessage({ status: 400, error: "invalid_otp" }, FALLBACK), /code is incorrect/i);
  assert.match(memberAuthMessage({ status: 400, code: "OTP_EXPIRED" }, FALLBACK), /expired/i);
  assert.match(memberAuthMessage({ status: 400, error: "otp_expired" }, FALLBACK), /expired/i);
});

test("too many attempts, from the limiter or from the code check", () => {
  assert.match(memberAuthMessage({ status: 429 }, FALLBACK), /too many attempts/i);
  assert.match(memberAuthMessage({ status: 403, code: "TOO_MANY_ATTEMPTS" }, FALLBACK), /new code/i);
  assert.match(memberAuthMessage({ status: 403, error: "too_many_attempts" }, FALLBACK), /new code/i);
});

test("registering an address already a member here points at sign-in", () => {
  assert.match(memberAuthMessage({ status: 409, error: "already_member" }, FALLBACK), /sign in/i);
});

test("a studio this session was not signed in on is a mismatch, worded plainly", () => {
  assert.match(memberAuthMessage({ status: 403, error: "tenant_mismatch" }, FALLBACK), /another studio/i);
});

test("a wrong password says so, without saying whether the email exists (#173)", () => {
  const message = memberAuthMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, FALLBACK);
  assert.match(message, /email or password/i);
  assert.match(memberAuthMessage({ status: 400, code: "INVALID_PASSWORD" }, FALLBACK), /current password/i);
});

test("a short password names the minimum, from either Better Auth or our routes", () => {
  assert.match(memberAuthMessage({ status: 400, code: "PASSWORD_TOO_SHORT" }, FALLBACK), /8 characters/);
  assert.match(memberAuthMessage({ status: 400, error: "password_too_short" }, FALLBACK), /8 characters/);
});

test("a used or expired set-password link asks for a new one", () => {
  assert.match(memberAuthMessage({ status: 400, error: "invalid_token" }, FALLBACK), /new link/i);
  assert.match(memberAuthMessage({ error: "INVALID_TOKEN" }, FALLBACK), /new link/i);
});

test("anything else falls back to the caller's words, never a raw code", () => {
  assert.equal(memberAuthMessage({ status: 500, message: "internal_error" }, FALLBACK), FALLBACK);
  assert.equal(memberAuthMessage(null, FALLBACK), FALLBACK);
});
