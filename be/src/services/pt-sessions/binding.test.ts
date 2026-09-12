import assert from 'node:assert'
import { maySchedulePtRequest } from './binding'

// The rule this module exists to hold: a package sold as "ten sessions with
// Coach X" is not one a different instructor can quietly pick up off the
// shared queue. The queue already hides those requests; this is what makes the
// hiding true rather than cosmetic, for a stale screen or a hand-made request.

const COACH_X = '11111111-1111-1111-1111-111111111111'
const COACH_Y = '22222222-2222-2222-2222-222222222222'

// --- an admin is never in the way ---

assert.deepStrictEqual(
  maySchedulePtRequest({ boundInstructorId: COACH_X, actorStaffId: COACH_Y, actorIsAdmin: true }),
  { ok: true },
  'an admin may schedule a bound package for whoever is free that day',
)
assert.deepStrictEqual(
  maySchedulePtRequest({ boundInstructorId: null, actorStaffId: COACH_Y, actorIsAdmin: true }),
  { ok: true },
  'an admin may schedule an unbound package',
)

// --- an unbound package stays open to every instructor ---

assert.deepStrictEqual(
  maySchedulePtRequest({ boundInstructorId: null, actorStaffId: COACH_Y, actorIsAdmin: false }),
  { ok: true },
  'an unbound package is the shared queue working as it always has',
)

// --- an instructor may take their own ---

assert.deepStrictEqual(
  maySchedulePtRequest({ boundInstructorId: COACH_X, actorStaffId: COACH_X, actorIsAdmin: false }),
  { ok: true },
  'the bound instructor picking up their own member is the common case',
)

// --- and nobody else may ---

assert.deepStrictEqual(
  maySchedulePtRequest({ boundInstructorId: COACH_X, actorStaffId: COACH_Y, actorIsAdmin: false }),
  { ok: false, error: 'pt_request_bound_to_other_instructor' },
  'a package bound to one coach is refused to another, with a reason that names why',
)

console.log('pt-sessions/binding.test.ts ok')
