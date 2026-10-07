import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCancellation, type CancellationFacts, type CancellationRecord } from './cancellation-summary'

// One wording of a cancellation for the member and for staff (#349, #351,
// #352): the summary's lines, differing only in whose cap and card it is.

const AT = new Date('2026-10-07T07:00:00.000Z')

const record = (over: Partial<CancellationRecord> = {}): CancellationRecord => ({
  source: 'client',
  wasWithinWindow: true,
  wasWithinCap: true,
  cancelledAt: AT,
  ...over,
})

const facts = (over: Partial<CancellationFacts> = {}): CancellationFacts => ({
  kind: 'class',
  refundOutcome: 'credit_returned',
  creditsUsed: 1,
  bookingCancelledAt: AT,
  record: record(),
  ...over,
})

const member = (over: Partial<CancellationFacts> = {}) => summarizeCancellation(facts(over)).member
const staff = (over: Partial<CancellationFacts> = {}) => summarizeCancellation(facts(over)).staff

// What each kind of cancel records.
const late = { record: record({ wasWithinWindow: false }), refundOutcome: 'forfeited' } as const
const overCap = { record: record({ wasWithinCap: false }), refundOutcome: 'forfeited' } as const
const nothing = { refundOutcome: 'n_a', creditsUsed: 0 } as const
const byStudio = { record: record({ source: 'admin' }) } as const

test('ACC-33 a cancelled class’s outcome line says where the credit went', () => {
  assert.equal(member(late).outcome, 'Late cancel · credit kept')
  assert.equal(member().outcome, 'Credit returned')
  assert.equal(member({ creditsUsed: 2 }).outcome, '2 credits returned')
  assert.equal(member(overCap).outcome, 'Cancelled over your cap · credit kept')
  assert.equal(member(nothing).outcome, 'Nothing to return')
  assert.equal(member({ ...late, ...nothing }).outcome, 'Late cancel · nothing to return')
})

test('ACC-33 a class the studio cancelled says so in its outcome line', () => {
  assert.equal(member(byStudio).outcome, 'Cancelled by the studio · credit returned')
  assert.equal(member({ ...byStudio, creditsUsed: 3 }).outcome, 'Cancelled by the studio · 3 credits returned')
  assert.equal(member({ ...byStudio, refundOutcome: 'forfeited' }).outcome, 'Cancelled by the studio · credit kept')
  assert.equal(member({ ...byStudio, ...nothing }).outcome, 'Cancelled by the studio · nothing to return')
  // No `cancellations` row at all (an unknown actor) is the studio's.
  assert.equal(member({ record: null }).outcome, 'Cancelled by the studio · credit returned')
})

test('ACC-33 a cancelled class says by whom where its outcome line does not', () => {
  assert.equal(member().who, 'You cancelled')
  // "Cancelled by the studio" is already its outcome line: said once per card.
  assert.equal(member(byStudio).who, 'Cancelled')
})

test('ACC-33 no cancelled-class line calls a returned credit a refund', () => {
  for (const source of ['client', 'admin', 'instructor', 'system'] as const) {
    for (const refundOutcome of ['credit_returned', 'forfeited', 'n_a'] as const) {
      for (const r of [record({ source }), record({ source, wasWithinWindow: false }), record({ source, wasWithinCap: false })]) {
        const s = summarizeCancellation(facts({ record: r, refundOutcome }))
        for (const { who, outcome } of [s.member, s.staff]) assert.doesNotMatch(`${who} ${outcome}`, /refund/i)
      }
    }
  }
})

// ── Private sessions, workshops and corporate (#351) ─────────────────────────

const pt = (over: Partial<CancellationFacts> = {}) =>
  member({ kind: 'pt', refundOutcome: 'session_returned', ...over })
const partner = { by: { actor: 'host' }, record: null, refundOutcome: 'n_a', creditsUsed: 0 } as const

test('ACC-35 a cancelled private session says when, who, and whether the session came back', () => {
  assert.deepEqual(pt(), { who: 'You cancelled', outcome: 'Session returned' })
  assert.deepEqual(pt(overCap), { who: 'You cancelled', outcome: 'Cancelled over your cap · session kept' })
  assert.deepEqual(pt(byStudio), { who: 'Cancelled', outcome: 'Cancelled by the studio · session returned' })
  // A 2on1 partner paid nothing (`n_a`): nothing of theirs came back or was kept.
  assert.deepEqual(pt(partner), { who: 'Cancelled', outcome: 'Cancelled by the host' })
  assert.equal(pt({ ...byStudio, ...nothing }).outcome, 'Cancelled by the studio')
})

test('ACC-35 a request withdrawn reads cancelled, one that expired unscheduled reads expired, each with the session returned', () => {
  const pending = (over: Partial<CancellationFacts>) => pt({ record: null, request: 'cancelled', by: { actor: 'member' }, ...over })
  assert.deepEqual(pending({}), { who: 'You cancelled', outcome: 'Request cancelled · session returned' })
  assert.deepEqual(pending({ request: 'expired', by: undefined }), { who: 'Expired', outcome: 'Request expired · session returned' })
  assert.equal(pending({ by: { actor: 'staff', staffName: 'Ana Tan' } }).outcome, 'Cancelled by the studio · session returned')
  // The partner's view of the host's request: the session was the host's.
  assert.equal(pending({ ...partner, request: 'expired', by: undefined }).outcome, 'Request expired')
  assert.equal(pending({ ...partner, request: 'cancelled' }).outcome, 'Cancelled by the host')
})

test('ACC-35 a cancelled workshop says whether the money went back to the card; a cancelled corporate request says the studio cancelled it', () => {
  const workshop = { kind: 'workshop', record: null, creditsUsed: 0 } as const
  assert.deepEqual(member({ ...workshop, refundOutcome: 'stripe_refunded', by: { actor: 'automatic' } }), {
    who: 'Cancelled by the studio',
    outcome: 'Refunded to your card',
  })
  assert.deepEqual(member({ ...workshop, refundOutcome: 'n_a', by: { actor: 'staff', staffName: 'Ana Tan' } }), {
    who: 'Cancelled',
    outcome: 'Cancelled by the studio · any refund is arranged by the studio',
  })
  assert.deepEqual(member({ kind: 'corporate', record: null, refundOutcome: null, creditsUsed: 0, by: { actor: 'studio' } }), {
    who: 'Cancelled',
    outcome: 'Cancelled by the studio',
  })
})

test('ACC-35 no private-session line calls a returned session a refund', () => {
  const bys = [{ actor: 'member' }, { actor: 'host' }, { actor: 'staff', staffName: 'Ana Tan' }, { actor: 'automatic' }] as const
  for (const request of [undefined, 'cancelled', 'expired'] as const) {
    for (const by of bys) {
      for (const refundOutcome of ['session_returned', 'forfeited', 'n_a'] as const) {
        const { who, outcome } = pt({ record: null, request, by, refundOutcome })
        assert.doesNotMatch(`${who} ${outcome}`, /refund/i)
      }
    }
  }
})

// ── Staff read the same lines (#352) ─────────────────────────────────────────

test('CUS-25 who cancelled: the member, the named staff member, Automatic, or the studio for an unnamed old cancel', () => {
  assert.equal(staff().who, 'Member')
  assert.equal(staff({ record: record({ source: 'admin', staffName: 'Ana Tan' }) }).who, 'Ana Tan')
  assert.equal(staff({ record: record({ source: 'system' }) }).who, 'Automatic')
  assert.equal(staff(byStudio).who, 'Studio')
})

test('CUS-25 where the credit went: the member’s own line, of their cap and their card, and a session for a private session', () => {
  assert.equal(staff().outcome, 'Credit returned')
  assert.equal(staff({ creditsUsed: 2 }).outcome, '2 credits returned')
  assert.equal(staff(late).outcome, 'Late cancel · credit kept')
  assert.equal(staff(overCap).outcome, 'Cancelled over their cap · credit kept')
  assert.equal(staff({ refundOutcome: 'forfeited' }).outcome, 'Credit kept')
  assert.equal(staff(nothing).outcome, 'Nothing to return')
  assert.equal(
    staff({ kind: 'workshop', record: null, refundOutcome: 'stripe_refunded', creditsUsed: 0, by: { actor: 'automatic' } }).outcome,
    'Refunded to their card',
  )
  assert.equal(staff({ kind: 'pt', refundOutcome: 'session_returned' }).outcome, 'Session returned')
  assert.equal(staff({ kind: 'pt', refundOutcome: 'forfeited' }).outcome, 'Session kept')
})

test('CUS-25 member and staff word every cancellation alike but for whose cap and card it is', () => {
  const cases: Partial<CancellationFacts>[] = [
    {}, late, overCap, nothing, byStudio, { kind: 'pt', ...overCap }, { kind: 'pt', ...partner },
    { kind: 'workshop', record: null, refundOutcome: 'stripe_refunded', by: { actor: 'automatic' } },
    { kind: 'workshop', record: null, refundOutcome: 'n_a', by: { actor: 'staff', staffName: 'Ana Tan' } },
  ]
  for (const c of cases) {
    const s = summarizeCancellation(facts(c))
    assert.equal(s.staff.outcome, s.member.outcome.replace(/\byour\b/g, 'their'))
  }
})
