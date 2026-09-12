import assert from 'node:assert'
import {
  composePurchaseEmail,
  contentsLine,
  purchaseSlug,
  validityLine,
  type PurchaseEmailInput,
} from './purchase-email'

const EXPIRY = new Date('2027-02-14T12:00:00Z')
const ACCOUNT_URL = 'https://northwind.reservetoday.app/account'

function input(over: Partial<PurchaseEmailInput> = {}): PurchaseEmailInput {
  return {
    kind: 'credit_bundle',
    clientName: 'Sarah',
    packageName: '10 Class Credit Bundle',
    creditsOrSessions: 10,
    expiresAt: EXPIRY,
    durationMonths: null,
    validityDays: 90,
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

// --- a bound PT package names the instructor in that same line (#109) --------
// The renderer has no conditionals, so a variable of its own would leave a
// dangling label on every open package. Folding it in is what keeps ONE
// template correct for a bound purchase and an open one.
{
  assert.strictEqual(
    contentsLine('pt', 5, 'Mei Ling'),
    '5 private sessions with Mei Ling',
    'a bound PT package tells the member who their sessions are with',
  )
  assert.strictEqual(
    contentsLine('pt', 1, 'Mei Ling'),
    '1 private session with Mei Ling',
    'the count is still singular beside the name',
  )
  assert.strictEqual(
    contentsLine('pt', 5, null),
    '5 private sessions',
    'an open PT package says nothing about an instructor, rather than saying nobody',
  )
  // Only a PT package can be bound, so a name arriving on any other kind is a
  // caller's mistake and must not reach the member's inbox as a sentence.
  assert.strictEqual(
    contentsLine('credit_bundle', 10, 'Mei Ling'),
    '10 class credits',
    'a Credit Bundle never names an instructor',
  )
  assert.strictEqual(
    composePurchaseEmail(input({ kind: 'pt', creditsOrSessions: 5, boundInstructorName: 'Mei Ling' }))
      .variables.contents_line,
    '5 private sessions with Mei Ling',
    'the whole email carries the binding through, not just the helper',
  )
}

// --- a Dormant purchase's validity line carries the activation sentence -----
// Every purchase is Dormant when the confirmation goes out. The length is the
// frozen `duration_months` or `validity_days`, so a later edit to the catalogue
// cannot restate what was sold.
{
  assert.strictEqual(
    validityLine('unlimited', null, 6, null),
    'Valid 6 months from your first class — your package activates when you make your first booking.',
    'a Dormant plan promises Activation on the first booking, in the domain’s words',
  )
  assert.strictEqual(
    validityLine('unlimited', null, 1, null),
    'Valid 1 month from your first class — your package activates when you make your first booking.',
    'one month is singular',
  )
  assert.strictEqual(
    validityLine('credit_bundle', null, null, 90),
    'Valid 90 days from your first class — your package activates when you make your first booking.',
    'a Dormant bundle promises the same, in days',
  )
  assert.strictEqual(
    validityLine('trial', null, null, 1),
    'Valid 1 day from your first class — your package activates when you make your first booking.',
    'one day is singular',
  )
  assert.strictEqual(
    validityLine('pt', null, null, 365),
    'Valid 365 days from your first session request — your package activates when you make your first booking.',
    'a PT package starts on its first session request, and says so',
  )
}

// --- an Activated package prints its date and never mentions activation ----
// A resent confirmation for a package that has since started tells the member
// the date its clock is actually running to.
{
  for (const kind of ['unlimited', 'credit_bundle', 'trial', 'pt'] as const) {
    const line = validityLine(kind, EXPIRY, 6, 90)
    assert.strictEqual(line, 'Expires 14 Feb 2027', `${kind} prints its expiry date`)
    assert.ok(!/activat/i.test(line), `${kind} is not waiting to activate`)
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
      packageName: 'Unlimited 6 Months — Harbour Studio',
      creditsOrSessions: null,
      expiresAt: null,
      durationMonths: 6,
      validityDays: null,
    }),
  )
  assert.deepStrictEqual(
    composed.variables,
    {
      client_name: 'Sarah',
      package_name: 'Unlimited 6 Months — Harbour Studio',
      contents_line: 'Unlimited classes',
      validity_line:
        'Valid 6 months from your first class — your package activates when you make your first booking.',
      receipt_url: ACCOUNT_URL,
    },
    'the five allow-listed variables, each a whole composed sentence',
  )
}

console.log('notifications/purchase-email.test ok')
