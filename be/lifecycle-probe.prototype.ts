/**
 * THROWAWAY DEBUG HARNESS — class lifecycle invariant probe.
 *
 *   npx tsx lifecycle-probe.prototype.ts
 *
 * Creates a scratch database (`yoga_lifecycle_probe`) on the SAME Postgres
 * server as dev, migrates it, and drives the REAL service functions against it.
 * The dev database is never opened. Drop this file when the bugs are fixed.
 *
 * Each probe asserts one lifecycle invariant. RED = the invariant is violated
 * by the code as it stands today.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const SCRATCH = 'yoga_lifecycle_probe'
const devUrl = new URL(process.env.DATABASE_URL!)
const adminUrl = new URL(devUrl.toString()); adminUrl.pathname = '/postgres'
const scratchUrl = new URL(devUrl.toString()); scratchUrl.pathname = '/' + SCRATCH

// Point every downstream import at the scratch DB. `db/index.ts` reads this at
// import time and dotenv does not override an already-set var, so this wins.
process.env.DATABASE_URL = scratchUrl.toString()

const MIN = 60_000
const results: { name: string; red: boolean; detail: string }[] = []

async function main() {
  // ── build the scratch database ────────────────────────────────────────────
  const admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE "${SCRATCH}"`)
  await admin.end()

  const mc = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} })
  await migrate(drizzle(mc), { migrationsFolder: './src/db/migrations' })
  await mc.end()
  console.log(`scratch db ready: ${SCRATCH}\n`)

  // Import AFTER DATABASE_URL is redirected.
  const { db } = await import('./src/db/index')
  const S = await import('./src/db/schema/index')
  const { bookClass } = await import('./src/services/bookings/book')
  const { cancelBooking } = await import('./src/services/bookings/cancel')
  const { cancelClass } = await import('./src/services/bookings/cancel-class')
  const { markAttendance } = await import('./src/services/bookings/check-in')
  const { markNoShow } = await import('./src/services/bookings/no-show')
  const { createClass, updateClass } = await import('./src/services/schedule/classes')

  // ── fixtures ──────────────────────────────────────────────────────────────
  let seq = 0
  const uniq = () => `p${Date.now().toString(36)}${seq++}`

  const [adminStaff] = await db.insert(S.staffUsers)
    .values({ email: `admin-${uniq()}@probe.test`, name: 'Probe Admin', role: 'admin', status: 'active' })
    .returning()
  const [instStaff] = await db.insert(S.staffUsers)
    .values({ email: `inst-${uniq()}@probe.test`, name: 'Probe Instructor', role: 'instructor', status: 'active' })
    .returning()
  await db.insert(S.instructors).values({ staffUserId: instStaff!.id })
  const [loc] = await db.insert(S.locations).values({ name: 'Probe Studio' }).returning()
  const [ctype] = await db.insert(S.classTypes).values({ name: 'Probe Vinyasa' }).returning()

  /** Fresh room per class — the room-conflict guard is real and would collide otherwise. */
  async function freshRoom() {
    const [r] = await db.insert(S.rooms)
      .values({ locationId: loc!.id, name: `Room ${uniq()}`, capacity: 20 }).returning()
    return r!.id
  }

  /** A member holding a 10-credit bundle that never expires. */
  async function member(name: string) {
    const [c] = await db.insert(S.clients).values({
      clerkUserId: `clerk_${uniq()}`, email: `${uniq()}@probe.test`, name, phone: '+6580000000',
    }).returning()
    const [pkg] = await db.insert(S.clientPackages).values({
      clientId: c!.id, kind: 'credit_bundle', creditsOrSessionsRemaining: 10,
      expiresAt: null, active: true, amountPaidSgd: '100.00',
    }).returning()
    return { id: c!.id, pkgId: pkg!.id, name }
  }

  /** A class positioned relative to now, in minutes. Own room + own instructor so
   *  the (working) room/instructor conflict guards never collide across probes. */
  async function klass(startMin: number, endMin: number, creditCost = 1, cap = 5) {
    const now = Date.now()
    const [st] = await db.insert(S.staffUsers)
      .values({ email: `inst-${uniq()}@probe.test`, name: `Inst ${uniq()}`, role: 'instructor', status: 'active' })
      .returning()
    await db.insert(S.instructors).values({ staffUserId: st!.id })
    return createClass({
      classTypeId: ctype!.id, mainInstructorId: st!.id, locationId: loc!.id, roomId: await freshRoom(),
      startsAt: new Date(now + startMin * MIN), endsAt: new Date(now + endMin * MIN),
      capacityOnline: cap, capacityWaitlist: 0, capacityBuffer: 0,
      creditCost, createdByStaffId: adminStaff!.id,
    })
  }

  const credits = async (pkgId: string) => (await db.query.clientPackages
    .findFirst({ where: (t, { eq }) => eq(t.id, pkgId) }))!.creditsOrSessionsRemaining
  const booking = async (id: string) => (await db.query.bookings
    .findFirst({ where: (t, { eq }) => eq(t.id, id) }))!
  const klassRow = async (id: string) => (await db.query.classes
    .findFirst({ where: (t, { eq }) => eq(t.id, id) }))!
  const countCancellations = async (bookingId: string) => (await db.query.cancellations
    .findMany({ where: (t, { eq }) => eq(t.bookingId, bookingId) })).length

  function probe(name: string, red: boolean, detail: string) {
    results.push({ name, red, detail })
    console.log(`${red ? 'RED  ' : 'green'}  ${name}\n        ${detail}\n`)
  }
  const tryIt = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null } catch (e: any) { return e.code ?? e.message ?? String(e) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P1 — RETIRED. Asserted the auto-no-show cron (`flipNoShows`) silently
  // forfeited un-ticked members. The cron is deleted (spec §11: "No automatic
  // no-show flip"), so there is no longer a code path to probe.
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // P2 — correcting a no-show to attended leaves the forfeit behind
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P2 Arjun')
    const c = await klass(-120, -60)
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()

    // Instructor marks them absent, then corrects it — they were in the room.
    await markNoShow({ bookingId: bk!.id, actorStaffId: adminStaff!.id })
    await markAttendance({ bookingId: bk!.id, staffId: adminStaff!.id, attended: true })
    const after = await booking(bk!.id)
    probe('P2  a corrected no-show leaves the booking "attended" AND "forfeited"',
      after.checkInState === 'attended' && after.refundOutcome === 'forfeited',
      `check_in_state=${after.checkInState} state=${after.state} ` +
      `refund_outcome=${after.refundOutcome} — the tick must clear the forfeit too`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P3 — a finished class can be moved into the future
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = await klass(-120, -60)
    const err = await tryIt(() => updateClass(c.id, {
      startsAt: new Date(Date.now() + 7 * 1440 * MIN),
      endsAt: new Date(Date.now() + (7 * 1440 + 60) * MIN),
    }))
    const row = await klassRow(c.id)
    probe('P3  a completed class can be rescheduled into the future',
      err === null && row.startsAt.getTime() > Date.now(),
      `updateClass rejected? ${err ?? 'no — it succeeded'}; starts_at is now ` +
      `${row.startsAt.toISOString()} (green = updateClass refuses a class past 'scheduled')`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P4 — repricing / shrinking capacity under live bookings
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m1 = await member('P4 a'), m2 = await member('P4 b')
    const c = await klass(60, 120, 1, 5)
    await bookClass({ clientId: m1.id, classId: c.id })
    await bookClass({ clientId: m2.id, classId: c.id })
    const reprice = await tryIt(() => updateClass(c.id, { creditCost: 5 }))
    const shrink  = await tryIt(() => updateClass(c.id, { capacityOnline: 1 }))
    const row = await klassRow(c.id)
    probe('P4  a class can be repriced and shrunk below its own roster',
      reprice === null && shrink === null && row.capacityOnline === 1,
      `credit_cost 1→${row.creditCost} (reprice: ${reprice ?? 'allowed'}) and ` +
      `capacity_online 5→${row.capacityOnline} (shrink: ${shrink ?? 'ALLOWED'}) ` +
      `with 2 confirmed bookings. green = the shrink below the roster was refused. ` +
      `Repricing stays allowed on purpose — existing bookings keep the ` +
      `credits_or_sessions_used they actually paid, so refunds are unaffected.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P5 — refunding a member who actually attended
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P5 Priya')
    const c = await klass(-120, -60)
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()
    await db.update(S.clientPackages).set({ creditsOrSessionsRemaining: 9 })
      .where((await import('drizzle-orm')).eq(S.clientPackages.id, m.pkgId))
    await markAttendance({ bookingId: bk!.id, staffId: adminStaff!.id, attended: true })

    const before = await credits(m.pkgId)
    const err = await tryIt(() => cancelBooking({
      bookingId: bk!.id, source: 'admin', actorStaffId: adminStaff!.id }))
    const after = await credits(m.pkgId)
    probe('P5  an admin can refund a class the member demonstrably attended',
      err === null && after! > before!,
      `cancelBooking on an attended booking → ${err ?? 'no error'}; credits ${before} → ${after}. ` +
      `green = refused; attendance keeps state='confirmed', so the state check alone let it through`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P6 — cancelling a class that already happened
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P6 attendee')
    const c = await klass(-120, -60)
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()
    await db.update(S.clientPackages).set({ creditsOrSessionsRemaining: 9 })
      .where((await import('drizzle-orm')).eq(S.clientPackages.id, m.pkgId))
    await markAttendance({ bookingId: bk!.id, staffId: adminStaff!.id, attended: true })

    const before = await credits(m.pkgId)
    const res = await tryIt(() => cancelClass({ classId: c.id, actorStaffId: adminStaff!.id }))
    const after = await credits(m.pkgId)
    probe('P6  a class that already ran can be cancelled, refunding its attendees',
      res === null && after! > before!,
      `cancelClass on a finished class: ${res ?? 'accepted'}; attendee credits ${before} → ${after}. ` +
      `(green = refused. Cancelling an ONGOING class is still allowed — see P7.)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P7 — no-show can be recorded on a class cancelled by the studio
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P7 member')
    // Ongoing, not finished: cancelClass refuses a completed class (P6), and
    // markNoShow refuses one that hasn't started — mid-session is the only window
    // where both halves of this probe are reachable.
    const c = await klass(-30, 30)
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()
    await db.update(S.clientPackages).set({ creditsOrSessionsRemaining: 9 })
      .where((await import('drizzle-orm')).eq(S.clientPackages.id, m.pkgId))
    // studio cancels — member is refunded
    await cancelClass({ classId: c.id, actorStaffId: adminStaff!.id })
    const refunded = await credits(m.pkgId)
    // now an instructor marks them a no-show on the cancelled class
    const err = await tryIt(() => markNoShow({ bookingId: bk!.id, actorStaffId: adminStaff!.id }))
    probe('P7  no-show is refused on a studio-cancelled class',
      err === null,
      `markNoShow after cancelClass → ${err ?? 'ACCEPTED'}; credits ${refunded}. ` +
      `(green = correctly refused because booking state flipped to cancelled)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P8 — attendance on a class that has not ended, and forever after
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P8 member')
    const c = await klass(-400 * 1440, -400 * 1440 + 60)   // 400 days ago
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()
    const err = await tryIt(() => markAttendance({
      bookingId: bk!.id, staffId: adminStaff!.id, attended: true }))
    probe('P8  attendance stays editable on an old class (accepted — control)',
      err !== null,
      `markAttendance on a 400-day-old class → ${err ?? 'ACCEPTED'}. ` +
      `check-in.ts guards the lower bound (class must have started) and deliberately ` +
      `has no upper bound — correcting a roster days later is legitimate. ` +
      `(green = still accepted; RED would mean someone added an upper bound.)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P9 — rescheduling a class forward strands its no-show bookings
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P9 member')
    const c = await klass(-120, -60)
    const { qrToken, code } = (await import('./src/services/bookings/qr')).generateBookingCodes()
    const [bk] = await db.insert(S.bookings).values({
      clientId: m.id, kind: 'class', classId: c.id, clientPackageId: m.pkgId,
      state: 'confirmed', creditsOrSessionsUsed: 1, qrToken, code,
    }).returning()
    await markNoShow({ bookingId: bk!.id, actorStaffId: adminStaff!.id })   // burned
    const err = await tryIt(() => updateClass(c.id, {
      startsAt: new Date(Date.now() + 3 * 1440 * MIN),
      endsAt: new Date(Date.now() + (3 * 1440 + 60) * MIN),
    }))
    const after = await booking(bk!.id)
    const row = await klassRow(c.id)
    probe('P9  a rescheduled class strands bookings already burned as no-shows',
      err === null && after.state === 'no_show' && row.startsAt.getTime() > Date.now(),
      `updateClass rejected? ${err ?? 'no — it succeeded'}; class starts ` +
      `${row.startsAt.toISOString()}, booking is state=${after.state} ` +
      `refund_outcome=${after.refundOutcome} — the member paid, is marked absent, ` +
      `and the class has not happened yet.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P10 — bookClass correctly refuses a cancelled / started class (control)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const m = await member('P10 member')
    const c1 = await klass(60, 120)
    await cancelClass({ classId: c1.id, actorStaffId: adminStaff!.id })
    const e1 = await tryIt(() => bookClass({ clientId: m.id, classId: c1.id }))
    const c2 = await klass(-30, 30)                          // in progress
    const e2 = await tryIt(() => bookClass({ clientId: m.id, classId: c2.id }))
    probe('P10 booking is refused on cancelled and in-progress classes (control)',
      e1 === null || e2 === null,
      `cancelled → ${e1 ?? 'ACCEPTED'}; in-progress → ${e2 ?? 'ACCEPTED'} ` +
      `(green = both correctly refused)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P11 — RETIRED. Measured how much a cron auto-no-show cost the member
  // (answer: nothing — the credit is debited at booking time; the harm was a
  // false "No-show" label). The cron is deleted, so there is nothing to measure.
  // ══════════════════════════════════════════════════════════════════════════

  // ── summary ───────────────────────────────────────────────────────────────
  const red = results.filter(r => r.red)
  console.log('─'.repeat(78))
  console.log(`${red.length} RED of ${results.length} probes`)
  for (const r of red) console.log(`  RED  ${r.name}`)
  const { closeDb } = await import('./src/db/index')
  await closeDb()
  process.exit(red.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
