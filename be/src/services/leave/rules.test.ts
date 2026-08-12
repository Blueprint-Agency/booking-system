import assert from 'node:assert'
import {
  COMMITTED_STATUSES,
  HALF_DAY_BOUNDARY_HOUR,
  MEDICAL_BACKDATE_DAYS,
  MEDICAL_CERT_MAX_BYTES,
  TAKEN_STATUSES,
  checkAdminLeaveDecision,
  checkMedicalCertificate,
  checkLeaveSubmission,
  checkOwnLeaveTransition,
  countLeaveDays,
  carriedDays,
  futureConflicts,
  leaveCoversStart,
  leavePoolFigures,
  leaveWindow,
  leaveYearOf,
  medicalCertKey,
  checkRemainingAdjustment,
  poolDays,
  poolForRemaining,
  sgToday,
  sumLeaveDays,
  type LeaveDaysRow,
} from './rules'

// -- day counting: inclusive of both ends ------------------------------------
{
  assert.strictEqual(countLeaveDays('2026-08-12', '2026-08-12'), 1, 'a single date is one day')
  assert.strictEqual(countLeaveDays('2026-08-12', '2026-08-14'), 3, 'both endpoints count')
  // a Sunday inside a range still costs a day — there is no working pattern
  assert.strictEqual(countLeaveDays('2026-08-14', '2026-08-17'), 4)
  // month and year boundaries
  assert.strictEqual(countLeaveDays('2026-01-31', '2026-02-01'), 2)
  assert.strictEqual(countLeaveDays('2026-12-31', '2027-01-01'), 2)
  // leap day is a day like any other
  assert.strictEqual(countLeaveDays('2028-02-28', '2028-03-01'), 3)
  // a backwards range is not a range
  assert.ok(countLeaveDays('2026-08-14', '2026-08-12') < 1)

  // a half day costs half a day, whichever half it is
  assert.strictEqual(countLeaveDays('2026-08-12', '2026-08-12', 'morning'), 0.5)
  assert.strictEqual(countLeaveDays('2026-08-12', '2026-08-12', 'afternoon'), 0.5)
  assert.strictEqual(countLeaveDays('2026-08-12', '2026-08-12', 'none'), 1)
}

// -- the leave year is the year the request starts in -------------------------
{
  assert.strictEqual(leaveYearOf('2026-08-12'), 2026)
  // a range crossing new year counts wholly against the year it began
  assert.strictEqual(leaveYearOf('2026-12-30'), 2026)
}

// -- a full leave day is the whole Singapore day, and no more -----------------
{
  const w = leaveWindow('2026-08-12', '2026-08-12')
  assert.strictEqual(w.startsAt.toISOString(), '2026-08-11T16:00:00.000Z', 'starts at SGT midnight')
  assert.strictEqual(w.endsAt.toISOString(), '2026-08-12T16:00:00.000Z', 'ends at the next SGT midnight')
  // a class at 23:00 SGT on the leave day is inside the window...
  const lateClass = Date.parse('2026-08-12T15:00:00.000Z') // 23:00 SGT
  assert.ok(lateClass >= w.startsAt.getTime() && lateClass < w.endsAt.getTime())
  // ...and one at 00:30 SGT the NEXT day is not: the window must not bleed over
  const nextMorning = Date.parse('2026-08-12T16:30:00.000Z') // 00:30 SGT on the 13th
  assert.ok(nextMorning >= w.endsAt.getTime())

  const range = leaveWindow('2026-08-12', '2026-08-14')
  assert.strictEqual(range.endsAt.toISOString(), '2026-08-14T16:00:00.000Z')
}

// -- a half day is that half of the Singapore day, split at 13:00 -------------
{
  assert.strictEqual(HALF_DAY_BOUNDARY_HOUR, 13)
  const boundary = '2026-08-12T05:00:00.000Z' // 13:00 SGT

  const am = leaveWindow('2026-08-12', '2026-08-12', 'morning')
  assert.strictEqual(am.startsAt.toISOString(), '2026-08-11T16:00:00.000Z', 'from SGT midnight')
  assert.strictEqual(am.endsAt.toISOString(), boundary, 'to 13:00 SGT')

  const pm = leaveWindow('2026-08-12', '2026-08-12', 'afternoon')
  assert.strictEqual(pm.startsAt.toISOString(), boundary, 'from 13:00 SGT')
  assert.strictEqual(pm.endsAt.toISOString(), '2026-08-12T16:00:00.000Z', 'to the next SGT midnight')

  // the two halves meet exactly and together cover the whole day, no more
  const full = leaveWindow('2026-08-12', '2026-08-12')
  assert.strictEqual(am.endsAt.getTime(), pm.startsAt.getTime())
  assert.strictEqual(am.startsAt.getTime(), full.startsAt.getTime())
  assert.strictEqual(pm.endsAt.getTime(), full.endsAt.getTime())

  // an event that CROSSES 13:00 sits inside both halves — 12:30–13:30 SGT
  const straddle = {
    startsAt: new Date('2026-08-12T12:30:00+08:00'),
    endsAt: new Date('2026-08-12T13:30:00+08:00'),
  }
  const within = (w: { startsAt: Date; endsAt: Date }) =>
    w.startsAt < straddle.endsAt && w.endsAt > straddle.startsAt
  assert.ok(within(am), 'a class over the boundary is partly in the morning')
  assert.ok(within(pm), 'and partly in the afternoon')
}

// -- the picker's question: is this instructor free to take THIS class? -------
{
  // a morning-leave instructor is unavailable for a 09:00 class...
  assert.strictEqual(leaveCoversStart('morning', '09:00'), true)
  // ...and available for a 15:00 one
  assert.strictEqual(leaveCoversStart('morning', '15:00'), false)
  // an afternoon-leave instructor is the reverse
  assert.strictEqual(leaveCoversStart('afternoon', '09:00'), false)
  assert.strictEqual(leaveCoversStart('afternoon', '15:00'), true)

  // the boundary itself belongs to the afternoon, the same half-open split
  // leaveWindow makes: morning ends AT 13:00, so a class starting then is not
  // in it
  assert.strictEqual(leaveCoversStart('morning', '13:00'), false)
  assert.strictEqual(leaveCoversStart('afternoon', '13:00'), true)
  // and the minute before is still the morning
  assert.strictEqual(leaveCoversStart('morning', '12:59'), true)
  assert.strictEqual(leaveCoversStart('afternoon', '12:59'), false)

  // a whole day off covers every class, whatever time it starts — and even when
  // no time is known at all
  for (const t of ['00:00', '09:00', '13:00', '23:30', '', undefined]) {
    assert.strictEqual(leaveCoversStart('none', t), true)
  }

  // with no start time known, a half day is not a refusal: the screen has only a
  // date, so the instructor is labelled and stays pickable
  for (const halfDay of ['morning', 'afternoon'] as const) {
    assert.strictEqual(leaveCoversStart(halfDay, undefined), false)
    assert.strictEqual(leaveCoversStart(halfDay, ''), false)
    assert.strictEqual(leaveCoversStart(halfDay, 'not a time'), false)
  }

  // The straddling class — 12:30 to 13:30 — sits in BOTH halves, so the server
  // refuses it on either half day. This question reads the START only, so it
  // says "away" for the morning and "free" for the afternoon: a hint may be
  // laxer than the server, never stricter.
  const straddle = {
    startsAt: new Date('2026-08-12T12:30:00+08:00'),
    endsAt: new Date('2026-08-12T13:30:00+08:00'),
  }
  const serverRefuses = (halfDay: 'morning' | 'afternoon') => {
    const w = leaveWindow('2026-08-12', '2026-08-12', halfDay)
    return w.startsAt < straddle.endsAt && w.endsAt > straddle.startsAt
  }
  assert.ok(serverRefuses('morning') && serverRefuses('afternoon'), 'the straddle clashes with both halves')
  assert.strictEqual(leaveCoversStart('morning', '12:30'), true)
  assert.strictEqual(leaveCoversStart('afternoon', '12:30'), false, 'the hint stays out of the server’s way')

  // ...and never the other way round: everything this refuses, the server would
  // have refused too — otherwise the picker would be hiding a bookable slot
  for (const halfDay of ['none', 'morning', 'afternoon'] as const) {
    for (const t of ['00:00', '08:00', '12:59', '13:00', '18:00', '23:00']) {
      if (!leaveCoversStart(halfDay, t)) continue
      const w = leaveWindow('2026-08-12', '2026-08-12', halfDay)
      const startsAt = new Date(`2026-08-12T${t}:00+08:00`)
      const endsAt = new Date(startsAt.getTime() + 3_600_000)
      assert.ok(
        w.startsAt < endsAt && w.endsAt > startsAt,
        `${halfDay} leave must really clash with a class at ${t}`,
      )
    }
  }
}

// -- "today" is a Singapore day, not a UTC one --------------------------------
{
  // 23:00 UTC on the 11th is already the 12th in Singapore
  assert.strictEqual(sgToday(new Date('2026-08-11T23:00:00.000Z')), '2026-08-12')
  assert.strictEqual(sgToday(new Date('2026-08-11T15:00:00.000Z')), '2026-08-11')
}

// -- what the sums count, and what a Pool is worth against them ---------------
const rows: LeaveDaysRow[] = [
  { type: 'annual', leaveYear: 2026, status: 'approved', days: 3 },
  { type: 'annual', leaveYear: 2026, status: 'pending', days: 2 },
  { type: 'annual', leaveYear: 2026, status: 'rejected', days: 5 },
  { type: 'annual', leaveYear: 2026, status: 'withdrawn', days: 5 },
  { type: 'annual', leaveYear: 2026, status: 'cancelled', days: 5 },
  { type: 'annual', leaveYear: 2026, status: 'revoked', days: 5 },
  { type: 'annual', leaveYear: 2025, status: 'approved', days: 9 },
  { type: 'medical', leaveYear: 2026, status: 'approved', days: 1 },
]
const annual2026 = { type: 'annual', leaveYear: 2026 } as const
{
  // taken = approved only; the four dead statuses never count
  assert.strictEqual(sumLeaveDays(rows, { ...annual2026, statuses: TAKEN_STATUSES }), 3)
  // the submission check also counts pending, so two requests can't overspend
  assert.strictEqual(sumLeaveDays(rows, { ...annual2026, statuses: COMMITTED_STATUSES }), 5)
  // types are separate pools
  assert.strictEqual(
    sumLeaveDays(rows, { type: 'medical', leaveYear: 2026, statuses: COMMITTED_STATUSES }),
    1,
  )
  // years are separate pools — last year's leave does not touch this year's
  assert.strictEqual(
    sumLeaveDays(rows, { type: 'annual', leaveYear: 2025, statuses: TAKEN_STATUSES }),
    9,
  )
  // ...and what a 14-day Pool is worth against them: Taken leaves 11 unused,
  // Committed leaves 9 — Remaining is the second, and the two differ whenever
  // something is awaiting a decision
  const against14 = leavePoolFigures('annual', 14, rows, 2026)
  assert.strictEqual(against14.pool - against14.taken, 11)
  assert.strictEqual(against14.remaining, 9)
  // cancelling gives the days back for free: drop the row, the sum changes
  const afterCancel = rows.map(r =>
    r.status === 'approved' && r.type === 'annual' && r.leaveYear === 2026
      ? { ...r, status: 'cancelled' as const }
      : r,
  )
  assert.strictEqual(sumLeaveDays(afterCancel, { ...annual2026, statuses: TAKEN_STATUSES }), 0)
  assert.strictEqual(leavePoolFigures('annual', 14, afterCancel, 2026).taken, 0)
  // the 2 pending days are all that is still Committed
  assert.strictEqual(leavePoolFigures('annual', 14, afterCancel, 2026).remaining, 12)
  // half days accumulate exactly — no float drift
  const halves: LeaveDaysRow[] = [0.5, 0.5, 0.5].map(days => ({
    type: 'annual',
    leaveYear: 2026,
    status: 'approved',
    days,
  }))
  assert.strictEqual(sumLeaveDays(halves, { ...annual2026, statuses: TAKEN_STATUSES }), 1.5)
  // ...mixed with whole days too, and 14 minus that is still exact
  const mixed: LeaveDaysRow[] = [1, 0.5, 0.5, 0.5, 2].map(days => ({
    type: 'annual',
    leaveYear: 2026,
    status: 'approved',
    days,
  }))
  assert.strictEqual(sumLeaveDays(mixed, { ...annual2026, statuses: TAKEN_STATUSES }), 4.5)
  assert.strictEqual(leavePoolFigures('annual', 14, mixed, 2026).remaining, 9.5)
  // a Pool lowered below what is Committed shows an honest negative rather than
  // a clamped zero
  assert.strictEqual(leavePoolFigures('annual', 2, rows, 2026).remaining, -3)
}

// -- the figures an instructor is shown: Remaining is Pool minus COMMITTED -----
{
  // 14-day Pool, 3 approved and 2 pending: Remaining is 9, not 14. It has to
  // agree with checkLeaveSubmission, which refuses anything over 9.
  assert.deepStrictEqual(leavePoolFigures('annual', 14, rows, 2026), {
    type: 'annual',
    pool: 14,
    taken: 3,
    pending: 2,
    remaining: 9,
  })
  // Taken stays approved-only — it is not the same number as 14 − remaining
  assert.strictEqual(leavePoolFigures('annual', 14, rows, 2026).taken, 3)

  // the four dead statuses (20 days of them in `rows`) count towards neither
  const alive: LeaveDaysRow[] = rows.filter(
    r => r.status === 'approved' || r.status === 'pending',
  )
  assert.deepStrictEqual(leavePoolFigures('annual', 14, alive, 2026), leavePoolFigures('annual', 14, rows, 2026))
  for (const status of ['rejected', 'withdrawn', 'cancelled', 'revoked'] as const) {
    const dead: LeaveDaysRow[] = [{ type: 'annual', leaveYear: 2026, status, days: 5 }]
    assert.deepStrictEqual(leavePoolFigures('annual', 14, dead, 2026), {
      type: 'annual',
      pool: 14,
      taken: 0,
      pending: 0,
      remaining: 14,
    })
  }

  // types are separate Pools — annual's 5 committed days do not touch medical
  assert.deepStrictEqual(leavePoolFigures('medical', 14, rows, 2026), {
    type: 'medical',
    pool: 14,
    taken: 1,
    pending: 0,
    remaining: 13,
  })
  // and so are Leave Years
  assert.deepStrictEqual(leavePoolFigures('annual', 14, rows, 2025), {
    type: 'annual',
    pool: 14,
    taken: 9,
    pending: 0,
    remaining: 5,
  })

  // a Pool below what is already Committed reports the negative rather than
  // clamping at zero — hiding it would be a lie
  assert.strictEqual(leavePoolFigures('annual', 4, rows, 2026).remaining, -1)
  assert.strictEqual(leavePoolFigures('annual', 0, rows, 2026).remaining, -5)

  // halves sum exactly: three approved half days are 1.5, not 1.4999999999
  const halves: LeaveDaysRow[] = [
    ...[0.5, 0.5, 0.5].map(days => ({ type: 'annual' as const, leaveYear: 2026, status: 'approved' as const, days })),
    { type: 'annual', leaveYear: 2026, status: 'pending', days: 0.5 },
  ]
  assert.deepStrictEqual(leavePoolFigures('annual', 14, halves, 2026), {
    type: 'annual',
    pool: 14,
    taken: 1.5,
    pending: 0.5,
    remaining: 12,
  })
}

// -- the Pool: Assigned plus Carried -------------------------------------------
{
  // carried 0 is every Pool in the system today — the Pool IS the Assigned Days
  assert.strictEqual(poolDays(14, 0), 14)
  assert.strictEqual(poolDays(0, 0), 0)
  // with days carried in, they add
  assert.strictEqual(poolDays(14, 3), 17)
  // halves survive exactly, in either operand — a back-solved Pool can hold one
  assert.strictEqual(poolDays(14, 0.5), 14.5)
  assert.strictEqual(poolDays(10.5, 3.5), 14)
  assert.strictEqual(poolDays(0.5, 0.5), 1)
  // and what it composes is what the figures are drawn from
  assert.strictEqual(leavePoolFigures('annual', poolDays(14, 0), rows, 2026).remaining, 9)
  assert.strictEqual(leavePoolFigures('annual', poolDays(14, 3), rows, 2026).remaining, 12)
}

// -- Carried Days: what last year's Remaining is worth this year ---------------
{
  // the cap is the ceiling, and it is the only thing between the previous
  // Remaining and this year's Pool
  assert.strictEqual(carriedDays('annual', 14, 14), 14, 'exactly at the cap carries whole')
  assert.strictEqual(carriedDays('annual', 13, 14), 13, 'one below the cap carries itself')
  assert.strictEqual(carriedDays('annual', 15, 14), 14, 'one above the cap carries the cap')
  assert.strictEqual(carriedDays('annual', 100, 14), 14)

  // an untouched year carries nothing, and neither does a year spent exactly out
  assert.strictEqual(carriedDays('annual', 0, 14), 0)

  // a Pool lowered below what was Committed leaves a negative Remaining. It is
  // shown negative (leavePoolFigures does not clamp) but it must NOT carry a
  // debt into the next year — the instructor starts the year whole.
  assert.strictEqual(carriedDays('annual', -1, 14), 0)
  assert.strictEqual(carriedDays('annual', -20, 14), 0)
  assert.strictEqual(carriedDays('annual', -0.5, 14), 0)

  // medical never carries. It is a property of this function, so no call site
  // can forget the branch — cap and previous Remaining are both irrelevant.
  assert.strictEqual(carriedDays('medical', 14, 14), 0)
  assert.strictEqual(carriedDays('medical', 3.5, 100), 0)
  assert.strictEqual(carriedDays('medical', -5, 0), 0)

  // halves carry as halves: 3.5 is 3.5, neither rounded down to 3 nor up to 4
  assert.strictEqual(carriedDays('annual', 3.5, 14), 3.5)
  assert.strictEqual(carriedDays('annual', 0.5, 14), 0.5)
  assert.strictEqual(carriedDays('annual', 14.5, 14), 14)

  // a cap of 0 turns carry-over off studio-wide
  assert.strictEqual(carriedDays('annual', 14, 0), 0)
  assert.strictEqual(carriedDays('annual', 0.5, 0), 0)

  // and what carries is what the next year's Pool is composed from
  assert.strictEqual(poolDays(14, carriedDays('annual', 3.5, 14)), 17.5)
  assert.strictEqual(poolDays(14, carriedDays('medical', 3.5, 14)), 14)
  // last year's Remaining comes from last year's figures, unclamped on the way in
  const previous = leavePoolFigures('annual', 14, rows, 2025).remaining
  assert.strictEqual(previous, 5)
  assert.strictEqual(poolDays(14, carriedDays('annual', previous, 14)), 19)
}

// -- the admin's adjustment: back-solving a Pool from a desired Remaining ------
{
  // nothing committed: the Pool IS the Remaining being asked for
  assert.strictEqual(poolForRemaining(14, 0), 14)
  assert.strictEqual(poolForRemaining(0, 0), 0)
  // whole days already committed push the Pool up by exactly what was spent
  assert.strictEqual(poolForRemaining(9, 5), 14)
  assert.strictEqual(poolForRemaining(1, 20), 21)
  // half days survive — 3.5 taken and 9 wanted is a Pool of 12.5, not 12 or 13
  assert.strictEqual(poolForRemaining(9, 3.5), 12.5)
  assert.strictEqual(poolForRemaining(0.5, 0.5), 1)
  assert.strictEqual(poolForRemaining(3.5, 3.5), 7)
  // three half days summed in halves is exactly 1.5, not 1.4999999999999998
  assert.strictEqual(poolForRemaining(0, 0.5 + 0.5 + 0.5), 1.5)

  // pending counts as much as approved: Committed is both, so a Pool solved
  // against 3 approved + 2 pending is solved against 5
  const committed = sumLeaveDays(rows, { ...annual2026, statuses: COMMITTED_STATUSES })
  assert.strictEqual(committed, 5)
  assert.strictEqual(poolForRemaining(9, committed), 14)

  // THE round trip: what the admin typed is what the instructor then sees.
  for (const wanted of [0, 1, 7.5, 9, 12, 20]) {
    assert.strictEqual(
      leavePoolFigures('annual', poolForRemaining(wanted, committed), rows, 2026).remaining,
      wanted,
      `a Pool back-solved for ${wanted} must yield exactly ${wanted}`,
    )
  }
  // ...including with halves on both sides, and with medical's separate rows
  const halves: LeaveDaysRow[] = [
    { type: 'annual', leaveYear: 2026, status: 'approved', days: 0.5 },
    { type: 'annual', leaveYear: 2026, status: 'approved', days: 3 },
    { type: 'annual', leaveYear: 2026, status: 'pending', days: 0.5 },
    { type: 'medical', leaveYear: 2026, status: 'approved', days: 2 },
  ]
  const halfCommitted = sumLeaveDays(halves, { ...annual2026, statuses: COMMITTED_STATUSES })
  assert.strictEqual(halfCommitted, 4)
  assert.strictEqual(
    leavePoolFigures('annual', poolForRemaining(9.5, halfCommitted), halves, 2026).remaining,
    9.5,
  )
  const medicalCommitted = sumLeaveDays(halves, {
    type: 'medical',
    leaveYear: 2026,
    statuses: COMMITTED_STATUSES,
  })
  assert.strictEqual(
    leavePoolFigures('medical', poolForRemaining(3.5, medicalCommitted), halves, 2026).remaining,
    3.5,
  )
}

// -- the admin's adjustment: what may be asked for ----------------------------
{
  // the ceiling is ASSIGNED DAYS PLUS CARRIED DAYS, not the stored Pool.
  // Granting more than that is a separate, deliberate act.
  const ceiling = poolDays(14, 0)
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 10, ceiling), { ok: true })
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 14, ceiling), { ok: true }, 'at the ceiling is allowed')
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 0, ceiling), { ok: true }, 'zero is allowed')
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 12.5, poolDays(12.5, 0)), { ok: true })
  // days carried in raise it, because they are part of what was agreed
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 17, poolDays(14, 3)), { ok: true })

  const over = checkRemainingAdjustment('annual', 14.5, ceiling)
  assert.strictEqual(over.ok, false)
  assert.strictEqual(over.ok === false && over.code, 'remaining_above_pool')
  // the refusal names the ceiling — an admin who overshoots is told the number
  assert.match(over.ok === false ? over.message : '', /14/)
  assert.match(over.ok === false ? over.message : '', /annual/)

  const under = checkRemainingAdjustment('medical', -0.5, ceiling)
  assert.strictEqual(under.ok, false)
  assert.strictEqual(under.ok === false && under.code, 'remaining_below_zero')
  assert.match(under.ok === false ? under.message : '', /medical/)

  // a ceiling of 0 admits exactly one figure
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 0, 0), { ok: true })
  assert.strictEqual(checkRemainingAdjustment('annual', 0.5, 0).ok, false)
}

// -- the adjustment is NOT a one-way ratchet ----------------------------------
{
  // 14 Assigned, nothing carried, nothing Committed. An admin typos 5.
  const ceiling = poolDays(14, 0)
  assert.deepStrictEqual(checkRemainingAdjustment('annual', 5, ceiling), { ok: true })
  // that back-solved the stored Pool down to 5 ...
  assert.strictEqual(poolForRemaining(5, 0), 5)
  // ... and putting the original figure back must still be allowed. Bounded
  // against the stored Pool it would not be, and the typo would stand until
  // 1 January (spec user story 27).
  assert.deepStrictEqual(
    checkRemainingAdjustment('annual', 14, ceiling),
    { ok: true },
    'restoring a mistyped figure is a correction, not a grant',
  )

  // the other direction is unchanged: above Assigned + Carried is still refused
  assert.strictEqual(checkRemainingAdjustment('annual', 14.5, ceiling).ok, false)
  assert.strictEqual(checkRemainingAdjustment('annual', 18, poolDays(14, 3)).ok, false)

  // and a Pool a previous adjustment RAISED does not raise the ceiling with it:
  // 14 Remaining against 5 days Committed back-solves to a Pool of 19, but 19
  // was never Assigned + Carried, so the next adjustment is still capped at 14.
  const committedFive = sumLeaveDays(rows, { ...annual2026, statuses: COMMITTED_STATUSES })
  assert.strictEqual(committedFive, 5)
  assert.strictEqual(poolForRemaining(14, committedFive), 19)
  assert.strictEqual(checkRemainingAdjustment('annual', 19, ceiling).ok, false)
  assert.strictEqual(checkRemainingAdjustment('annual', 15, ceiling).ok, false)
}

// -- submission: what is left of the Pool -------------------------------------
const base = { today: '2026-08-10', pool: 14, committedDays: 0 } as const
{
  const over = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-20',
    endDate: '2026-08-24',
    committedDays: 12,
  })
  assert.strictEqual(over.ok, false)
  assert.strictEqual(over.ok === false && over.code, 'insufficient_leave_balance')
  // the refusal has to name the Pool and what remains of it, or the instructor
  // can't fix it — and it says so in the glossary's terms, not "your allowance"
  assert.match(over.ok === false ? over.message : '', /5 days/)
  assert.match(over.ok === false ? over.message : '', /annual Pool this year is 14 days/)
  assert.match(over.ok === false ? over.message : '', /2 remaining/)
  assert.doesNotMatch(over.ok === false ? over.message : '', /allowance/i)

  // exactly at the Remaining is allowed
  const exact = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-20',
    endDate: '2026-08-21',
    committedDays: 12,
  })
  assert.deepStrictEqual(exact, { ok: true, days: 2, leaveYear: 2026 })

  // one day past it is not
  assert.strictEqual(
    checkLeaveSubmission({
      ...base,
      type: 'annual',
      startDate: '2026-08-20',
      endDate: '2026-08-22',
      committedDays: 12,
    }).ok,
    false,
  )

  // medical draws on its own Pool — a spent annual Pool does not block it
  const medical = checkLeaveSubmission({
    ...base,
    type: 'medical',
    startDate: '2026-08-11',
    endDate: '2026-08-11',
    committedDays: 0,
  })
  assert.strictEqual(medical.ok, true)
}

// -- submission: the dates ----------------------------------------------------
{
  const startsToday = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-10',
    endDate: '2026-08-10',
  })
  assert.strictEqual(startsToday.ok === false && startsToday.code, 'annual_leave_must_start_in_future')

  const yesterday = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-09',
    endDate: '2026-08-09',
  })
  assert.strictEqual(yesterday.ok === false && yesterday.code, 'annual_leave_must_start_in_future')

  // tomorrow is fine
  assert.strictEqual(
    checkLeaveSubmission({ ...base, type: 'annual', startDate: '2026-08-11', endDate: '2026-08-11' }).ok,
    true,
  )

  // medical may reach back exactly seven days...
  assert.strictEqual(MEDICAL_BACKDATE_DAYS, 7)
  assert.strictEqual(
    checkLeaveSubmission({ ...base, type: 'medical', startDate: '2026-08-03', endDate: '2026-08-03' }).ok,
    true,
  )
  // ...and no further
  const tooFar = checkLeaveSubmission({
    ...base,
    type: 'medical',
    startDate: '2026-08-02',
    endDate: '2026-08-02',
  })
  assert.strictEqual(tooFar.ok === false && tooFar.code, 'medical_leave_backdated_too_far')
  // medical today, and medical in the future, are both fine
  assert.strictEqual(
    checkLeaveSubmission({ ...base, type: 'medical', startDate: '2026-08-10', endDate: '2026-08-10' }).ok,
    true,
  )
  assert.strictEqual(
    checkLeaveSubmission({ ...base, type: 'medical', startDate: '2026-09-01', endDate: '2026-09-01' }).ok,
    true,
  )

  // an end before the start is refused as a range, not as a Pool problem
  const backwards = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-20',
    endDate: '2026-08-18',
  })
  assert.strictEqual(backwards.ok === false && backwards.code, 'invalid_date_range')
}

// -- submission: half days ----------------------------------------------------
{
  // a single date marked morning or afternoon costs half a day
  for (const halfDay of ['morning', 'afternoon'] as const) {
    assert.deepStrictEqual(
      checkLeaveSubmission({
        ...base,
        type: 'annual',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        halfDay,
      }),
      { ok: true, days: 0.5, leaveYear: 2026 },
    )
  }

  // a range is full days only — the marker is refused, not quietly ignored
  const range = checkLeaveSubmission({
    ...base,
    type: 'annual',
    startDate: '2026-08-20',
    endDate: '2026-08-21',
    halfDay: 'morning',
  })
  assert.strictEqual(range.ok === false && range.code, 'half_day_requires_single_date')
  assert.match(range.ok === false ? range.message : '', /single date/)
  // and the same range without the marker is simply two days
  assert.deepStrictEqual(
    checkLeaveSubmission({ ...base, type: 'annual', startDate: '2026-08-20', endDate: '2026-08-21' }),
    { ok: true, days: 2, leaveYear: 2026 },
  )

  // half a day left is enough for a half day, and not enough for a whole one
  const halfLeft = { ...base, type: 'annual', startDate: '2026-08-20', endDate: '2026-08-20' } as const
  assert.strictEqual(checkLeaveSubmission({ ...halfLeft, committedDays: 13.5, halfDay: 'afternoon' }).ok, true)
  const wholeDay = checkLeaveSubmission({ ...halfLeft, committedDays: 13.5 })
  assert.strictEqual(wholeDay.ok === false && wholeDay.code, 'insufficient_leave_balance')
  assert.match(wholeDay.ok === false ? wholeDay.message : '', /0\.5 remaining/)
  // and a half day with nothing left is still refused
  assert.strictEqual(checkLeaveSubmission({ ...halfLeft, committedDays: 14, halfDay: 'morning' }).ok, false)

  // the other rules still apply to a half day — annual can't start today
  assert.strictEqual(
    checkLeaveSubmission({ ...base, type: 'annual', startDate: base.today, endDate: base.today, halfDay: 'morning' })
      .ok,
    false,
  )
}

// -- clashes: only what ends in the future blocks -----------------------------
{
  const now = new Date('2026-08-10T04:00:00.000Z') // noon SGT
  const finished = { id: 'past', ends_at: '2026-08-10T03:00:00.000Z' }
  const running = { id: 'now', ends_at: '2026-08-10T05:00:00.000Z' }
  const later = { id: 'future', ends_at: '2026-09-01T03:00:00.000Z' }
  assert.deepStrictEqual(
    futureConflicts([finished, running, later], now).map(c => c.id),
    ['now', 'future'],
    'a class that already finished never blocks leave',
  )
  assert.deepStrictEqual(futureConflicts([finished], now), [], 'backdated medical leave stays filable')
  assert.deepStrictEqual(futureConflicts([], now), [])
}

// -- withdraw and cancel ------------------------------------------------------
{
  const today = '2026-08-10'
  assert.deepStrictEqual(checkOwnLeaveTransition('withdraw', { status: 'pending', startDate: '2026-08-20' }, today), {
    ok: true,
    status: 'withdrawn',
  })
  // an approved request is cancelled, not withdrawn
  assert.strictEqual(
    checkOwnLeaveTransition('withdraw', { status: 'approved', startDate: '2026-08-20' }, today).ok,
    false,
  )
  assert.deepStrictEqual(checkOwnLeaveTransition('cancel', { status: 'approved', startDate: '2026-08-20' }, today), {
    ok: true,
    status: 'cancelled',
  })
  // approved leave that starts today has started
  const started = checkOwnLeaveTransition('cancel', { status: 'approved', startDate: today }, today)
  assert.strictEqual(started.ok === false && started.code, 'leave_already_started')
  // and nothing can be done twice
  assert.strictEqual(
    checkOwnLeaveTransition('cancel', { status: 'cancelled', startDate: '2026-08-20' }, today).ok,
    false,
  )
  assert.strictEqual(
    checkOwnLeaveTransition('withdraw', { status: 'withdrawn', startDate: '2026-08-20' }, today).ok,
    false,
  )
}

// -- approve and reject: only a request still awaiting a decision -------------
{
  const today = '2026-08-10'
  const pending = { status: 'pending' as const, startDate: '2026-08-20' }

  assert.deepStrictEqual(checkAdminLeaveDecision('approve', pending, today), {
    ok: true,
    status: 'approved',
  })
  assert.deepStrictEqual(checkAdminLeaveDecision('reject', pending, today), {
    ok: true,
    status: 'rejected',
  })

  // a request that starts today, or started last week, is still decidable —
  // backdated medical leave is filed after the fact and must be approvable
  assert.strictEqual(
    checkAdminLeaveDecision('approve', { status: 'pending', startDate: today }, today).ok,
    true,
  )
  assert.strictEqual(
    checkAdminLeaveDecision('approve', { status: 'pending', startDate: '2026-08-04' }, today).ok,
    true,
  )

  // nothing already settled can be decided again
  for (const status of ['approved', 'rejected', 'withdrawn', 'cancelled', 'revoked'] as const) {
    for (const action of ['approve', 'reject'] as const) {
      const res = checkAdminLeaveDecision(action, { status, startDate: '2026-08-20' }, today)
      assert.strictEqual(res.ok, false, `${action} must refuse a ${status} request`)
      assert.strictEqual(res.ok === false && res.code, 'leave_not_pending')
    }
  }
  // the refusal says what state it is actually in, so the admin isn't guessing
  const settled = checkAdminLeaveDecision('reject', { status: 'withdrawn', startDate: '2026-08-20' }, today)
  assert.match(settled.ok === false ? settled.message : '', /already withdrawn/)
  assert.match(settled.ok === false ? settled.message : '', /rejected/)
}

// -- revoke: approved leave only, and only before it starts -------------------
{
  const today = '2026-08-10'
  assert.deepStrictEqual(
    checkAdminLeaveDecision('revoke', { status: 'approved', startDate: '2026-08-11' }, today),
    { ok: true, status: 'revoked' },
    'approved leave starting tomorrow can be revoked',
  )

  // leave starting today has started — nothing in the past is editable
  const startsToday = checkAdminLeaveDecision('revoke', { status: 'approved', startDate: today }, today)
  assert.strictEqual(startsToday.ok === false && startsToday.code, 'leave_already_started')

  // ...and neither is leave that is already over
  const past = checkAdminLeaveDecision('revoke', { status: 'approved', startDate: '2026-07-01' }, today)
  assert.strictEqual(past.ok === false && past.code, 'leave_already_started')

  // only APPROVED leave is revocable — a pending request is rejected, not revoked
  for (const status of ['pending', 'rejected', 'withdrawn', 'cancelled', 'revoked'] as const) {
    const res = checkAdminLeaveDecision('revoke', { status, startDate: '2026-08-20' }, today)
    assert.strictEqual(res.ok, false, `revoke must refuse a ${status} request`)
    assert.strictEqual(res.ok === false && res.code, 'leave_not_approved')
  }
}

// -- a revoked or rejected request stops counting, with no bookkeeping --------
{
  const approved: LeaveDaysRow[] = [
    { type: 'annual', leaveYear: 2026, status: 'approved', days: 4 },
    { type: 'annual', leaveYear: 2026, status: 'approved', days: 2 },
  ]
  assert.strictEqual(leavePoolFigures('annual', 14, approved, 2026).taken, 6)
  assert.strictEqual(leavePoolFigures('annual', 14, approved, 2026).remaining, 8)
  // flip one to the status the admin's decision writes — the days come back
  const afterRevoke = approved.map((r, i) => (i === 0 ? { ...r, status: 'revoked' as const } : r))
  assert.strictEqual(leavePoolFigures('annual', 14, afterRevoke, 2026).taken, 2)
  assert.strictEqual(leavePoolFigures('annual', 14, afterRevoke, 2026).remaining, 12)
  // a rejected request never counted against the submission check either
  const pending: LeaveDaysRow[] = [{ type: 'annual', leaveYear: 2026, status: 'pending', days: 4 }]
  assert.strictEqual(leavePoolFigures('annual', 14, pending, 2026).remaining, 10)
  assert.strictEqual(
    leavePoolFigures(
      'annual',
      14,
      pending.map(r => ({ ...r, status: 'rejected' as const })),
      2026,
    ).remaining,
    14,
  )
}

// -- the medical certificate rule --------------------------------------------
{
  const ok = (contentType: string, size = 1024) =>
    checkMedicalCertificate({ leaveType: 'medical', contentType, size })

  // the three allowed types, and the extension each is stored as
  assert.deepStrictEqual(ok('image/jpeg'), { ok: true, extension: 'jpg' })
  assert.deepStrictEqual(ok('image/png'), { ok: true, extension: 'png' })
  assert.deepStrictEqual(ok('application/pdf'), { ok: true, extension: 'pdf' })
  // a parameterised / uppercased content type is still the same type
  assert.deepStrictEqual(ok('IMAGE/PNG; charset=binary'), { ok: true, extension: 'png' })

  // anything else is refused, whatever it calls itself
  for (const type of ['image/gif', 'text/html', 'image/svg+xml', 'application/zip', '']) {
    const res = ok(type)
    assert.strictEqual(res.ok, false, `${type} must be refused`)
    if (!res.ok) assert.strictEqual(res.code, 'certificate_type_not_allowed')
  }

  // annual leave has nothing to evidence — the type gate is in the rule, not the UI
  const annual = checkMedicalCertificate({
    leaveType: 'annual',
    contentType: 'application/pdf',
    size: 10,
  })
  assert.strictEqual(annual.ok, false)
  if (!annual.ok) assert.strictEqual(annual.code, 'certificate_not_medical_leave')

  // 5MB exactly is fine; one byte more is not
  assert.strictEqual(MEDICAL_CERT_MAX_BYTES, 5 * 1024 * 1024)
  assert.strictEqual(ok('image/jpeg', MEDICAL_CERT_MAX_BYTES).ok, true)
  const tooBig = ok('image/jpeg', MEDICAL_CERT_MAX_BYTES + 1)
  assert.strictEqual(tooBig.ok, false)
  if (!tooBig.ok) assert.strictEqual(tooBig.code, 'certificate_too_large')

  const empty = ok('image/jpeg', 0)
  assert.strictEqual(empty.ok, false)
  if (!empty.ok) assert.strictEqual(empty.code, 'certificate_empty')

  // the key is deterministic — a second upload replaces the first
  const key = medicalCertKey('instr-1', 'req-1', 'pdf')
  assert.strictEqual(key, 'medical-certificates/instr-1/req-1.pdf')
  assert.strictEqual(medicalCertKey('instr-1', 'req-1', 'pdf'), key)
  assert.notStrictEqual(medicalCertKey('instr-2', 'req-1', 'pdf'), key)
}

console.log('leave rules.test ok')
