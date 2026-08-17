import assert from 'node:assert'
import {
  composePurchaseEmail,
  contentsLine,
  purchaseSlug,
  validityLine,
  type PurchaseEmailInput,
} from './purchase-email'

const EXPIRY = new Date('2027-02-14T12:00:00Z')
const ACCOUNT_URL = 'https://book.yogasadhana.sg/account'

function input(over: Partial<PurchaseEmailInput> = {}): PurchaseEmailInput {
  return {
    kind: 'credit_bundle',
    clientName: 'Sarah',
    packageName: '10 Class Credit Bundle',
    creditsOrSessions: 10,
    expiresAt: EXPIRY,
    durationMonths: null,
    receiptUrl: null,
    accountUrl: ACCOUNT_URL,
    ...over,
  }
}

// --- the contents line for each of the four package shapes -------------------
// It replaces `credits_or_sessions`, which was null for an Unlimited Plan and
// left any label the template wrapped around it dangling.
{
  assert.strictEqual(
    contentsLine('unlimited', null),
    'Unlimited classes',
    'an Unlimited Plan has no number to print, so the line says what it is',
  )
  assert.strictEqual(
    contentsLine('credit_bundle', 10),
    '10 class credits',
    'a Credit Bundle counts credits',
  )
  assert.strictEqual(
    contentsLine('pt', 5),
    '5 private sessions',
    'a PT package counts private sessions',
  )
  assert.strictEqual(
    contentsLine('trial', 3),
    '3 classes',
    'a trial pass counts plain classes — a first-timer has never heard of a credit',
  )
  assert.strictEqual(
    contentsLine('credit_bundle', 1),
    '1 class credit',
    'one credit is singular',
  )
}

// --- the Unlimited validity line carries the activation sentence -------------
// A Dormant plan is the only purchase with no date to print, and only an
// Unlimited Plan can ever be Dormant. The months figure is the frozen
// `duration_months`, so a later edit to the catalogue cannot restate what was
// sold.
{
  assert.strictEqual(
    validityLine('unlimited', null, 6),
    'Valid 6 months from your first class — your plan activates when you make your first booking.',
    'a Dormant plan promises Activation on the first booking, in the domain’s words',
  )
  assert.strictEqual(
    validityLine('unlimited', null, 1),
    'Valid 1 month from your first class — your plan activates when you make your first booking.',
    'one month is singular',
  )
  // An Unlimited Plan bought when the member holds no live plan is NOT Dormant:
  // its clock started at purchase, and the end date it was sold is the thing
  // that member is owed. Promising Activation there would be false.
  const activated = validityLine('unlimited', EXPIRY, 6)
  assert.strictEqual(
    activated,
    'Expires 14 Feb 2027',
    'an Activated plan prints the end date its clock is already running to',
  )
  assert.ok(!/activat/i.test(activated), 'an Activated plan is not waiting to activate')
}

// --- every other kind's validity line carries a date and never mentions
// --- activation --------------------------------------------------------------
// This is what stops the activation promise leaking onto a Credit Bundle: it is
// decided by kind in code, not by copy an admin can edit into the wrong template.
{
  for (const kind of ['credit_bundle', 'trial', 'pt'] as const) {
    const line = validityLine(kind, EXPIRY, null)
    assert.strictEqual(line, 'Expires 14 Feb 2027', `${kind} prints its expiry date`)
    assert.ok(!/activat/i.test(line), `${kind} must never promise Activation`)
    assert.ok(!/first class|first booking/i.test(line), `${kind} has no first-class clock`)
  }
}

// --- the receipt URL falls back to the account page --------------------------
// An escaped empty value inside an href renders a visible link that goes
// nowhere, so the free paths point at the page that lists what they bought.
{
  const free = composePurchaseEmail(input({ kind: 'trial', creditsOrSessions: 3 }))
  assert.strictEqual(
    free.variables.receipt_url,
    ACCOUNT_URL,
    'a free purchase has no receipt, so the link goes to the account page',
  )
  const paid = composePurchaseEmail(
    input({ receiptUrl: 'https://pay.stripe.com/receipts/abc' }),
  )
  assert.strictEqual(
    paid.variables.receipt_url,
    'https://pay.stripe.com/receipts/abc',
    'a paid purchase links its real receipt',
  )
}

// --- the slug is chosen from the granted package's kind ----------------------
// A *priced* trial goes through the payment provider and the webhook, so a
// branch on the code path would send it the paid-package email.
{
  assert.strictEqual(purchaseSlug('trial'), 'trial_pass_purchase_confirmed')
  for (const kind of ['credit_bundle', 'unlimited', 'pt'] as const) {
    assert.strictEqual(
      purchaseSlug(kind),
      'package_purchase_confirmed',
      `${kind} gets the package email`,
    )
  }
  assert.strictEqual(
    composePurchaseEmail(input({ kind: 'trial', creditsOrSessions: 3 })).slug,
    'trial_pass_purchase_confirmed',
    'the composed email carries the kind-chosen slug',
  )
}

// --- every declared variable is filled ---------------------------------------
// The renderer substitutes a missing variable with an empty string, so a
// forgotten key is a silently blank sentence rather than a failure.
{
  const composed = composePurchaseEmail(
    input({
      kind: 'unlimited',
      packageName: 'Unlimited 6 Months — Breadtalk IHQ',
      creditsOrSessions: null,
      expiresAt: null,
      durationMonths: 6,
    }),
  )
  assert.deepStrictEqual(
    composed.variables,
    {
      client_name: 'Sarah',
      package_name: 'Unlimited 6 Months — Breadtalk IHQ',
      contents_line: 'Unlimited classes',
      validity_line:
        'Valid 6 months from your first class — your plan activates when you make your first booking.',
      receipt_url: ACCOUNT_URL,
    },
    'the five allow-listed variables, each a whole composed sentence',
  )
}

console.log('notifications/purchase-email.test ok')
