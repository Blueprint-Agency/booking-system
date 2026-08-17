import test from "node:test";
import assert from "node:assert";
import { UNATTRIBUTED, fetchFinance, saveInstructorPay, type FinanceRow } from "./finance";
import { type Api } from "./api";

// Captures the one request the module makes — no Clerk session, no React.
function spyApi(seen: { path?: string; query?: unknown; body?: unknown }): Api {
  return {
    get: async (path: string, query?: unknown) => {
      seen.path = path;
      seen.query = query;
      return {};
    },
    patch: async (path: string, body?: unknown) => {
      seen.path = path;
      seen.body = body;
      return {};
    },
  } as unknown as Api;
}

const row = (p: Partial<FinanceRow>): FinanceRow => ({
  kind: "instructor_pay",
  type: "class",
  id: "sess-1",
  occurred_at: "2026-06-01T02:00:00.000Z",
  ends_at: null,
  variant: "Hatha",
  user_name: "Anya",
  location_id: null,
  location_name: null,
  unattributed: true,
  list_price_sgd: null,
  paid_sgd: null,
  discount_sgd: null,
  promo_code: null,
  refunded: false,
  instructor_id: "i-1",
  instructor_name: "Anya",
  pay_sgd: null,
  unpriced: true,
  pay_kind: "class",
  class_type_id: "ct-1",
  session_type: null,
  duration_minutes: 60,
  editable: true,
  ...p,
});

// "All types" / "All locations" are empty strings in the pickers; sending one as
// a filter is a 400 from the enum/uuid validators, not an unfiltered list. The
// search box is trimmed for the same reason — a box holding only spaces is empty.
test("unset filters are omitted, not sent blank", async () => {
  const seen: { query?: unknown } = {};
  await fetchFinance(spyApi(seen), {
    type: "",
    q: "   ",
    location: "",
    range: null,
  });
  assert.deepStrictEqual(seen.query, {
    type: undefined,
    q: undefined,
    location: undefined,
    needs_pay: undefined,
    from: undefined,
    to: undefined,
  });
});

// Unattributed is a real filter value, not the absence of one — it must survive
// the same "empty means all" trimming that drops a blank Location.
test("the Unattributed bucket is sent as a value", async () => {
  const seen: { query?: unknown } = {};
  await fetchFinance(spyApi(seen), { location: UNATTRIBUTED, range: null });
  assert.strictEqual((seen.query as { location?: string }).location, UNATTRIBUTED);
});

test("needs-pay is only sent when it is on", async () => {
  const on: { query?: unknown } = {};
  const off: { query?: unknown } = {};
  await fetchFinance(spyApi(on), { needsPay: true, range: null });
  await fetchFinance(spyApi(off), { needsPay: false, range: null });
  assert.strictEqual((on.query as { needs_pay?: string }).needs_pay, "true");
  assert.strictEqual((off.query as { needs_pay?: string }).needs_pay, undefined);
});

// Finance flattens class/PT/workshop pay into one display kind; the write has to
// find its way back to the right table, and it uses what the backend said rather
// than guessing from the row's other fields.
test("a pay edit routes by the kind the backend supplied", async () => {
  for (const kind of ["class", "pt", "workshop", "manual"] as const) {
    const seen: { path?: string } = {};
    await saveInstructorPay(spyApi(seen), row({ pay_kind: kind }), 50);
    assert.strictEqual(seen.path, `/portal/admin/finance/pay/${kind}/sess-1`);
  }
});

// A session with supporting instructors has several pay rows sharing one id;
// omitting the instructor would silently reprice the main one instead.
test("a pay edit names the instructor whose row it is", async () => {
  const seen: { body?: unknown } = {};
  await saveInstructorPay(spyApi(seen), row({ instructor_id: "i-9" }), 50);
  assert.deepStrictEqual(seen.body, { instructor_pay_sgd: 50, instructor_id: "i-9" });
});

// Clearing is a real edit — it puts the session back to Unpriced.
test("clearing pay sends null, not a missing field", async () => {
  const seen: { body?: unknown } = {};
  await saveInstructorPay(spyApi(seen), row({}), null);
  assert.strictEqual((seen.body as { instructor_pay_sgd: number | null }).instructor_pay_sgd, null);
});

// A purchase or a Refund carries no pay. Reaching this would mean the screen
// rendered an edit box on the payment provider's record.
test("a row with no pay kind refuses to be saved", () => {
  assert.throws(
    () => saveInstructorPay(spyApi({}), row({ kind: "purchase", pay_kind: null }), 10),
    /carries no pay to edit/,
  );
});
