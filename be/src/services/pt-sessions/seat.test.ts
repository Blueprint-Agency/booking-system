import assert from 'node:assert'
import { mayPayForSeat, orderSeatCandidates, type SeatPackage } from './seat'

// The rule a manual PT session (#334) asks of every package offered for a
// seat: may this one pay for it? A refusal is a package that cannot pay at all;
// a warning is one staff may still charge, but only after saying so.

const COACH_X = '11111111-1111-1111-1111-111111111111'
const COACH_Y = '22222222-2222-2222-2222-222222222222'
const NOW = new Date('2026-09-27T10:00:00Z')
const LATER = new Date('2026-12-01T00:00:00Z')
const EARLIER = new Date('2026-09-01T00:00:00Z')

const pkg = (over: Partial<SeatPackage> = {}): SeatPackage => ({
  kind: 'pt',
  sessionType: '1on1',
  creditsOrSessionsRemaining: 5,
  expiresAt: null,
  active: true,
  boundInstructorId: null,
  ...over,
})
const oneOnOne = { sessionType: '1on1' as const, instructorId: COACH_X }
const twoOnOne = { sessionType: '2on1' as const, instructorId: COACH_X }
const asAdmin = { actorIsAdmin: true, now: NOW }
const asInstructor = { actorIsAdmin: false, now: NOW }

// --- a matching, open, live package pays without a word ---

assert.deepStrictEqual(mayPayForSeat({ pkg: pkg(), session: oneOnOne, ...asAdmin }), { ok: true, warnings: [] })
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ expiresAt: LATER }), session: oneOnOne, ...asInstructor }),
  { ok: true, warnings: [] },
  'a running package pays too',
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ creditsOrSessionsRemaining: 1 }), session: twoOnOne, ...asAdmin }).ok,
  true,
  'a seat costs one session whatever the type: each attendee of a 2on1 pays their own',
)

// --- refusals: nothing staff can say makes these pay ---

for (const kind of ['credit_bundle', 'unlimited', 'trial'] as const) {
  assert.deepStrictEqual(
    mayPayForSeat({ pkg: pkg({ kind, sessionType: null }), session: oneOnOne, ...asAdmin }),
    { ok: false, refusal: 'not_a_pt_package' },
    `a ${kind} never pays for a private session`,
  )
}
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ expiresAt: EARLIER, active: false }), session: oneOnOne, ...asAdmin }),
  { ok: false, refusal: 'package_expired' },
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ expiresAt: EARLIER }), session: oneOnOne, ...asAdmin }),
  { ok: false, refusal: 'package_expired' },
  'ended at its date even before the nightly sweep flips it off',
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ creditsOrSessionsRemaining: 0, active: false }), session: oneOnOne, ...asAdmin }),
  { ok: false, refusal: 'insufficient_pt_credit' },
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ active: false }), session: oneOnOne, ...asAdmin }),
  { ok: false, refusal: 'package_not_consumable' },
  'a Voided package with sessions left still cannot pay',
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ boundInstructorId: COACH_Y }), session: oneOnOne, ...asInstructor }),
  { ok: false, refusal: 'bound_to_other_instructor' },
  "an instructor may not take another coach's client",
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ kind: 'credit_bundle', sessionType: null, expiresAt: EARLIER }), session: oneOnOne, ...asAdmin }),
  { ok: false, refusal: 'not_a_pt_package' },
  'the kind is the first thing wrong with a class package',
)

// --- an instructor's own and open clients ---

assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ boundInstructorId: COACH_X }), session: oneOnOne, ...asInstructor }),
  { ok: true, warnings: [] },
  'bound to the session instructor',
)
assert.deepStrictEqual(mayPayForSeat({ pkg: pkg(), session: oneOnOne, ...asInstructor }), { ok: true, warnings: [] })

// --- warnings: staff may charge it, having said so ---

assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ sessionType: '1on1' }), session: twoOnOne, ...asAdmin }),
  { ok: true, warnings: ['session_type_mismatch'] },
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ sessionType: '2on1' }), session: oneOnOne, ...asInstructor }),
  { ok: true, warnings: ['session_type_mismatch'] },
  'an instructor may seat across types too',
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ boundInstructorId: COACH_Y }), session: oneOnOne, ...asAdmin }),
  { ok: true, warnings: ['bound_to_other_instructor'] },
  'an admin is warned, not refused, when the coach is away',
)
assert.deepStrictEqual(
  mayPayForSeat({ pkg: pkg({ sessionType: '2on1', boundInstructorId: COACH_Y }), session: oneOnOne, ...asAdmin }),
  { ok: true, warnings: ['session_type_mismatch', 'bound_to_other_instructor'] },
  'every warning is named, not only the first',
)

// --- the Default payer's order ---

const c = (id: string, over: Partial<SeatPackage> & { purchasedAt?: Date } = {}) => ({
  id,
  purchasedAt: over.purchasedAt ?? new Date('2026-01-01T00:00:00Z'),
  pkg: pkg(over),
})
const ordered = orderSeatCandidates(
  [
    c('mismatched-running', { sessionType: '2on1', expiresAt: LATER }),
    c('dormant-new', { purchasedAt: new Date('2026-06-01T00:00:00Z') }),
    c('running-late', { expiresAt: new Date('2027-01-01T00:00:00Z') }),
    c('dormant-old', { purchasedAt: new Date('2026-02-01T00:00:00Z') }),
    c('running-soon', { expiresAt: LATER }),
  ],
  oneOnOne,
).map(x => x.id)
assert.deepStrictEqual(
  ordered,
  ['running-soon', 'running-late', 'dormant-old', 'dormant-new', 'mismatched-running'],
  'matching type first, running before Dormant, soonest-ending first, then oldest bought',
)

console.log('pt-sessions/seat.test.ts ok')
