import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { studioFixtures, type MemberFixture, type StaffFixture, type Studio } from './studio-fixtures'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * An Admin running the studio's members over real HTTP (#268): the Customers
 * directory and its search, the customer profile, blocking and unblocking, the
 * set-password link, and what an Instructor is refused.
 *
 * Every test runs in a studio of its own (`studio-fixtures.ts`). Each change
 * that succeeds is checked for its audit row too — under the studio, naming the
 * Admin who made it.
 *
 * The profile's bookings are read against the wall clock (`now()` in SQL), so
 * the history here is placed relative to it, not to the harness clock.
 */
describe('admins manage customers over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let f!: Awaited<ReturnType<typeof studioFixtures>>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    f = await studioFixtures(harness, schema, 'customers-admin')
    // Pinned for the rules that read the clock (booking, package validity). The
    // profile's own reads use SQL `now()`, which this is within seconds of.
    harness.clock.set(new Date())
  })

  after(async () => {
    await harness?.close()
  })

  const clientsPath = (rest = '') => `/portal/admin/clients${rest}`

  const clientRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, id))
    return row!
  }

  /** `count` members straight into the table, as an import writes them, named in join order. */
  const manyMembers = async (studio: Studio, count: number) => {
    const rows = Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(4, '0')
      return {
        tenantId: studio.id,
        email: `bulk-${n}@${studio.slug}.test`,
        name: `Bulk Member ${n}`,
        phone: `+65 8100 ${n}`,
        authUserId: `bulk_${studio.slug}_${n}`,
        joinedAt: new Date(Date.now() - (count - i) * MINUTE),
      }
    })
    for (let i = 0; i < rows.length; i += 500) await harness.db.insert(schema.clients).values(rows.slice(i, i + 500))
  }

  test('CUS-01 with thousands of members, a page of 50 holds 50 rows and the total counts them all', async () => {
    const studio = await f.freshStudio()
    const admin = await f.staffAt(studio, 'admin', 'admin')
    await manyMembers(studio, 2_030)

    const byDefault = f.expectStatus(await f.send(clientsPath(), { headers: admin.headers }), 200)
    assert.equal(byDefault.page_size, 50, 'the page size is 50 unless asked otherwise')
    assert.equal(byDefault.clients.length, 50)
    assert.equal(byDefault.total, 2_030)

    const asked = f.expectStatus(await f.send(clientsPath('?page_size=50&page=2'), { headers: admin.headers }), 200)
    assert.equal(asked.clients.length, 50)
    assert.equal(asked.total, 2_030)
    const firstIds = new Set(byDefault.clients.map((c: { id: string }) => c.id))
    assert.ok(!asked.clients.some((c: { id: string }) => firstIds.has(c.id)), 'page 2 repeats nobody from page 1')

    const last = f.expectStatus(await f.send(clientsPath('?page_size=50&page=41'), { headers: admin.headers }), 200)
    assert.equal(last.clients.length, 30, 'the last page holds the remainder')
    assert.equal(last.total, 2_030)
  })

  test('CUS-02 a member on no page on screen is found by name, email or phone', async () => {
    const studio = await f.freshStudio()
    const admin = await f.staffAt(studio, 'admin', 'admin')
    await manyMembers(studio, 120)
    // The earliest joined: last under the default newest-first sort, well past page 1.
    const [sought] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.id), eq(schema.clients.email, `bulk-0001@${studio.slug}.test`)))
    const page1 = f.expectStatus(await f.send(clientsPath('?page_size=25'), { headers: admin.headers }), 200)
    assert.ok(!page1.clients.some((c: { id: string }) => c.id === sought!.id), 'not on the first page')

    for (const q of ['bulk member 0001', `BULK-0001@${studio.slug}.test`, '8100 0001']) {
      const found = f.expectStatus(await f.send(clientsPath(`?page_size=25&q=${encodeURIComponent(q)}`), { headers: admin.headers }), 200)
      assert.equal(found.total, 1, `searching ${q}: ${JSON.stringify(found.clients.map((c: { name: string }) => c.name))}`)
      assert.equal(found.clients[0].id, sought!.id)
    }
  })

  describe('the Trials filter', () => {
    /** A member who bought a trial and holds it, with the trial's one class at `classAt`. */
    const trialMember = async (studio: Studio, name: string, trialClassId: string, checkIn: 'attended' | 'no_show') => {
      const member = await f.memberAt(studio, name)
      const trial = await f.heldPackage(studio, member.id, {
        kind: 'trial',
        validityDays: 7,
        creditsOrSessionsRemaining: 0,
        amountPaidSgd: '20.00',
        listPriceSgd: '20.00',
        active: false,
        expiresAt: new Date(Date.now() - 20 * DAY),
        purchasedAt: new Date(Date.now() - 30 * DAY),
      })
      await f.bookingRow(studio, member.id, trialClassId, trial.id, { checkInState: checkIn, state: checkIn === 'no_show' ? 'no_show' : 'confirmed' })
      return member
    }

    const trialsOf = async (admin: StaffFixture) =>
      f.expectStatus(await f.send(clientsPath('?filter=trials&page_size=100'), { headers: admin.headers }), 200)

    test('CUS-05 a trial member who skipped the trial and later attended on a bundle reads zero attended', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const trialClass = await f.classAt(studio, teacher.id, new Date(Date.now() - 28 * DAY))
      const skipped = await trialMember(studio, 'skipped', trialClass, 'no_show')
      const came = await trialMember(studio, 'came', trialClass, 'attended')

      // The one who skipped comes back later on a bundle and attends three classes.
      const bundle = await f.heldPackage(studio, skipped.id, { purchasedAt: new Date(Date.now() - 10 * DAY) })
      for (const daysAgo of [9, 6, 3]) {
        const later = await f.classAt(studio, teacher.id, new Date(Date.now() - daysAgo * DAY))
        await f.bookingRow(studio, skipped.id, later, bundle.id, { checkInState: 'attended' })
      }

      const trials = await trialsOf(admin)
      const row = (id: string) => trials.clients.find((c: { id: string }) => c.id === id)
      assert.equal(row(skipped.id).attended, 0, 'attendance on the bundle is not attendance on the trial')
      assert.equal(row(came.id).attended, 1)
      assert.equal(trials.funnel.trials, 2)
      assert.equal(trials.funnel.attended, 1, 'only the one who came to their trial is counted as attended')
    })

    test('CUS-06 a Complimentary Package or a second trial is not a conversion; paying for a non-trial package is', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const trialClass = await f.classAt(studio, teacher.id, new Date(Date.now() - 28 * DAY))
      const comped = await trialMember(studio, 'comped', trialClass, 'attended')
      const twice = await trialMember(studio, 'twice', trialClass, 'attended')
      const paid = await trialMember(studio, 'paid', trialClass, 'attended')

      // Given free, through the profile's own action.
      const bundle = await f.catalogPackage(studio)
      const given = f.expectStatus(
        await f.send(clientsPath(`/${comped.id}/packages/issue`), {
          body: { package_kind: 'class', package_id: bundle.id, reason: 'Sorry about the aircon' },
          headers: admin.headers,
        }),
        201,
      )
      await f.expectAudit(studio, admin, `POST /api/v1${clientsPath(`/${comped.id}/packages/issue`)}`, {
        table: 'client_packages',
        id: given.client_package_id,
      })
      // A second trial cannot even be held: a member has one trial, ever. What
      // can be proven is that a trial, paid for, is itself no conversion — each
      // member here paid S$20 for theirs, which would count if trials were not
      // set apart.
      await assert.rejects(
        f.heldPackage(studio, twice.id, { kind: 'trial', validityDays: 7, creditsOrSessionsRemaining: 1, amountPaidSgd: '20.00', listPriceSgd: '20.00' }),
        (err: { cause?: { constraint_name?: string } }) => {
          assert.equal(err.cause?.constraint_name, 'client_packages_trial_unique_per_client')
          return true
        },
      )
      // A bundle, paid for.
      await f.heldPackage(studio, paid.id, { sourceClassPackageId: bundle.id, amountPaidSgd: '180.00' })

      const trials = await trialsOf(admin)
      const converted = (id: string) => trials.clients.find((c: { id: string }) => c.id === id).converted
      assert.equal(converted(comped.id), false, 'a Complimentary Package is not a conversion')
      assert.equal(converted(twice.id), false, 'a second trial is not a conversion')
      assert.equal(converted(paid.id), true)
      assert.deepEqual(trials.funnel, { trials: 3, attended: 3, converted: 1 })
    })
  })

  describe('the customer profile', () => {
    /**
     * A member with 55 classes behind them — 50 attended, 2 no-shows, a late
     * cancel and 2 cancelled in time — the oldest attended ones furthest back.
     */
    const withLongHistory = async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const member = await f.memberAt(studio, 'regular')
      const pkg = await f.heldPackage(studio, member.id, { creditsOrSessionsRemaining: 100 })
      const outcomes: Record<number, Partial<typeof schema.bookings.$inferInsert>> = {
        3: { state: 'no_show', checkInState: 'no_show' },
        10: { state: 'no_show', checkInState: 'no_show' },
        5: { state: 'cancelled', checkInState: 'n_a', refundOutcome: 'forfeited', cancelledAt: new Date() },
        2: { state: 'cancelled', checkInState: 'n_a', refundOutcome: 'credit_returned', cancelledAt: new Date() },
        54: { state: 'cancelled', checkInState: 'n_a', refundOutcome: 'credit_returned', cancelledAt: new Date() },
      }
      const now = Date.now()
      const startsAt = (daysAgo: number) => new Date(now - daysAgo * DAY)
      for (let daysAgo = 1; daysAgo <= 55; daysAgo++) {
        const classId = await f.classAt(studio, teacher.id, startsAt(daysAgo))
        await f.bookingRow(studio, member.id, classId, pkg.id, outcomes[daysAgo] ?? { checkInState: 'attended' })
      }
      return { studio, admin, member, startsAt }
    }

    test('CUS-08 the attendance strip counts every booking the member ever had, not just the history listed', async () => {
      const { admin, member, startsAt } = await withLongHistory()
      const profile = f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
      assert.equal(profile.past_bookings.length, 50, 'the listed history stops at 50')
      assert.deepEqual(
        { ...profile.attendance, last_attended_at: new Date(profile.attendance.last_attended_at).getTime() },
        { attended: 50, no_shows: 2, late_cancels: 1, last_attended_at: startsAt(1).getTime() },
      )
    })

    test('CUS-11 the history is the 50 most recent past bookings, newest first, cancelled ones included', async () => {
      const { admin, member, startsAt } = await withLongHistory()
      const profile = f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
      const history: Array<{ starts_at: string; state: string }> = profile.past_bookings
      assert.deepEqual(
        history.map(b => new Date(b.starts_at).getTime()),
        Array.from({ length: 50 }, (_, i) => startsAt(i + 1).getTime()),
        'days 1 to 50 ago, newest first',
      )
      assert.equal(history.filter(b => b.state === 'cancelled').length, 2, 'the late cancel and the one cancelled in time, both within the 50')
      assert.equal(history.filter(b => b.state === 'no_show').length, 2)
    })

    test('CUS-09 running then Dormant under Current, and expired, used-up and refunded under Past, by the backend standing', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const member = await f.memberAt(studio, 'collector')
      const bought = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY)
      const dormant = await f.heldPackage(studio, member.id, { expiresAt: null, purchasedAt: bought(1) })
      const running = await f.heldPackage(studio, member.id, { expiresAt: new Date(Date.now() + 30 * DAY), purchasedAt: bought(40) })
      const expired = await f.heldPackage(studio, member.id, { creditsOrSessionsRemaining: 4, active: false, expiresAt: bought(5), purchasedAt: bought(95) })
      const usedUp = await f.heldPackage(studio, member.id, { creditsOrSessionsRemaining: 0, active: false, purchasedAt: bought(60) })
      // What a Refund's unwind leaves: credits unspent, the package switched off.
      const refunded = await f.heldPackage(studio, member.id, { creditsOrSessionsRemaining: 10, active: false, purchasedAt: bought(20) })

      const profile = f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
      const view = (list: Array<{ id: string; standing: string }>) => list.map(p => [p.id, p.standing])
      assert.deepEqual(view(profile.packages), [
        [running.id, 'running'],
        [dormant.id, 'dormant'],
      ])
      assert.deepEqual(view(profile.past_packages), [
        [refunded.id, 'ended'],
        [usedUp.id, 'used_up'],
        [expired.id, 'expired'],
      ], 'newest bought first')
    })

    test('CUS-10 an imported package with no Purchase shows the recorded amount, and nothing to derive a discount from', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const member = await f.memberAt(studio, 'imported')
      const pkg = await f.heldPackage(studio, member.id, { amountPaidSgd: '150.00', listPriceSgd: '200.00', purchaseId: null })

      const profile = f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
      const [shown] = profile.packages
      assert.equal(shown.id, pkg.id)
      assert.equal(shown.amount_paid_sgd, '150.00', 'what the old system recorded')
      assert.equal(shown.paid_online, false, 'no online payment on record, so no discount is derived')
      assert.equal(shown.complimentary, false, 'and it was not given free either')
      assert.deepEqual(profile.payments, [], 'no payment through the provider stands behind it')
    })
  })

  describe('blocking', () => {
    const block = (admin: StaffFixture, member: MemberFixture) =>
      f.send(clientsPath(`/${member.id}`), { method: 'DELETE', headers: admin.headers })
    const unblock = (admin: StaffFixture, member: MemberFixture) =>
      f.send(clientsPath(`/${member.id}/restore`), { body: {}, headers: admin.headers })
    const myAccount = (member: MemberFixture, headers = member.headers) => f.send('/me', { headers })

    test('CUS-12 blocking ends their sessions, refuses new sign-ins and member calls, and drops them from the default list', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const member = await f.memberAt(studio, 'troublesome')
      f.expectStatus(await myAccount(member), 200)

      const blocked = f.expectStatus(await block(admin, member), 200)
      assert.ok(blocked.deleted_at)
      assert.equal(blocked.deleted_by_staff_id, admin.id)

      f.expectStatus(await myAccount(member), 401)
      f.expectStatus(await f.send('/me/bookings', { headers: member.headers }), 401)
      const signIn = await f.memberSignIn(studio, member.email)
      assert.equal(signIn.headers.get('set-auth-token'), null, 'no session is handed out')
      f.expectStatus({ status: signIn.status, body: await signIn.json() }, 403, 'client_blocked')

      const listed = f.expectStatus(await f.send(clientsPath('?page_size=200'), { headers: admin.headers }), 200)
      assert.ok(!listed.clients.some((c: { id: string }) => c.id === member.id), 'gone from the default list')
      const row = await clientRow(member.id)
      assert.ok(row.deletedAt)
      assert.equal(row.deletedByStaffId, admin.id)
      await f.expectAudit(studio, admin, `DELETE /api/v1${clientsPath(`/${member.id}`)}`, { table: 'clients', id: member.id })
    })

    test('CUS-13 blocking leaves the member\'s upcoming bookings booked', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const member = await f.memberAt(studio, 'booked-ahead')
      const pkg = await f.heldPackage(studio, member.id)
      const classes = [
        await f.classAt(studio, teacher.id, new Date(Date.now() + 2 * DAY)),
        await f.classAt(studio, teacher.id, new Date(Date.now() + 9 * DAY)),
      ]
      const bookingIds: string[] = []
      for (const classId of classes) bookingIds.push(f.expectStatus(await f.book(member, classId), 201).booking_id)
      const creditsBefore = (await f.packageRow(pkg.id)).creditsOrSessionsRemaining

      f.expectStatus(await block(admin, member), 200)
      await f.expectAudit(studio, admin, `DELETE /api/v1${clientsPath(`/${member.id}`)}`, { table: 'clients', id: member.id })

      for (const id of bookingIds) {
        const [booking] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
        assert.equal(booking!.state, 'confirmed')
        assert.equal(booking!.cancelledAt, null)
      }
      assert.deepEqual(await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.clientId, member.id)), [])
      assert.equal((await f.packageRow(pkg.id)).creditsOrSessionsRemaining, creditsBefore, 'no credit moved')
      const profile = f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
      assert.equal(profile.upcoming_bookings.length, 2, 'the profile still shows both as upcoming')
    })

    test('CUS-14 an admin finds a blocked member under Blocked and unblocks them; they sign in and book again', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const member = await f.memberAt(studio, 'returning')
      await f.heldPackage(studio, member.id)
      const classId = await f.classAt(studio, teacher.id, new Date(Date.now() + 3 * DAY))
      f.expectStatus(await block(admin, member), 200)

      const blockedList = f.expectStatus(await f.send(clientsPath('?filter=blocked'), { headers: admin.headers }), 200)
      assert.deepEqual(blockedList.clients.map((c: { id: string }) => c.id), [member.id])

      const restored = f.expectStatus(await unblock(admin, member), 200)
      assert.equal(restored.deleted_at, null)
      assert.equal((await clientRow(member.id)).deletedAt, null)
      await f.expectAudit(studio, admin, `POST /api/v1${clientsPath(`/${member.id}/restore`)}`, { table: 'clients', id: member.id })
      assert.deepEqual(f.expectStatus(await f.send(clientsPath('?filter=blocked'), { headers: admin.headers }), 200).clients, [])

      const signIn = await f.memberSignIn(studio, member.email)
      assert.equal(signIn.status, 200, await signIn.clone().text())
      const token = signIn.headers.get('set-auth-token')
      assert.ok(token)
      const again = { ...member, headers: { ...f.memberHeaders(studio), Authorization: `Bearer ${token}` } }
      f.expectStatus(await myAccount(again), 200)
      const booked = f.expectStatus(await f.book(again, classId), 201)
      const [booking] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, booked.booking_id))
      assert.equal(booking!.state, 'confirmed')
    })

    test("CUS-12, CUS-14 blocking and unblocking another studio's member is 404, and an instructor is refused 403", async () => {
      const studio = await f.freshStudio()
      const elsewhere = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const outsider = await f.staffAt(elsewhere, 'admin', 'admin')
      const member = await f.memberAt(studio, 'member')

      f.expectStatus(await block(outsider, member), 404, 'client_not_found')
      f.expectStatus(await unblock(outsider, member), 404, 'client_not_found')
      f.expectStatus(await block(teacher, member), 403)
      assert.equal((await clientRow(member.id)).deletedAt, null)
      f.expectStatus(await myAccount(member), 200)

      // Unblocking, the same: blocked by their own admin, still blocked after the others try.
      f.expectStatus(await block(admin, member), 200)
      f.expectStatus(await unblock(outsider, member), 404, 'client_not_found')
      f.expectStatus(await unblock(teacher, member), 403)
      assert.ok((await clientRow(member.id)).deletedAt)
      assert.deepEqual(await f.auditRowsAt(elsewhere), [])
      assert.deepEqual((await f.auditRowsAt(studio)).filter(r => r.actorStaffId !== admin.id), [])
    })
  })

  test('CUS-15 an instructor is refused the member profile, payments, balance and a manual adjustment, and nothing changes', async () => {
    const studio = await f.freshStudio()
    const admin = await f.staffAt(studio, 'admin', 'admin')
    const teacher = await f.staffAt(studio, 'teacher', 'instructor')
    const member = await f.memberAt(studio, 'private-person')
    const pkg = await f.heldPackage(studio, member.id, { creditsOrSessionsRemaining: 5 })

    const attempts: Array<[string, string, unknown]> = [
      ['GET', clientsPath(), undefined],
      ['GET', clientsPath(`/${member.id}`), undefined],
      ['GET', clientsPath(`/${member.id}/export`), undefined],
      ['GET', `/portal/admin/purchases?client_id=${member.id}`, undefined],
      ['POST', clientsPath(`/${member.id}/packages/${pkg.id}/adjust`), { delta: 5, reason: 'for me' }],
      ['POST', clientsPath(`/${member.id}/packages/${pkg.id}/balance`), { balance: 50, reason: 'for me' }],
    ]
    for (const [method, path, body] of attempts) {
      const res = await f.send(path, { method, body, headers: teacher.headers })
      assert.equal(res.status, 403, `${method} ${path}: ${JSON.stringify(res.body)}`)
      assert.ok(!JSON.stringify(res.body ?? '').includes(member.email), `${method} ${path} answered with the member's data`)
    }

    assert.equal((await f.packageRow(pkg.id)).creditsOrSessionsRemaining, 5)
    assert.deepEqual(await harness.db.select().from(schema.manualAdjustments).where(eq(schema.manualAdjustments.clientPackageId, pkg.id)), [])
    assert.deepEqual((await f.auditRowsAt(studio)).filter(r => r.actorStaffId === teacher.id), [])
    // The admin, for contrast, reads it.
    f.expectStatus(await f.send(clientsPath(`/${member.id}`), { headers: admin.headers }), 200)
  })

  describe('AUTH-13 an admin sends a member a set-password link', () => {
    const mailsTo = (email: string) => discardedMail.filter(m => m.to === email)

    /** Follow the newest link mailed to `email`, as an inbox opens it, to the token the booking app receives. */
    const tokenFromLink = async (email: string) => {
      const mail = mailsTo(email).at(-1)
      assert.ok(mail, `no mail was sent to ${email}`)
      const match = mail.html.match(/href="([^"]*\/reset-password\/[^"]+)"/)
      assert.ok(match, 'the message carries no set-password link')
      const link = new URL(match[1]!.replace(/&amp;/g, '&'))
      const opened = await harness.app.request(link.pathname + link.search)
      assert.equal(opened.status, 302, await opened.clone().text())
      const token = new URL(opened.headers.get('location')!).searchParams.get('token')
      assert.ok(token, 'the link handed over no token')
      return token
    }

    const setPassword = (studio: Studio, token: string, password: string) =>
      f.send('/public/members/set-password', { body: { token, password }, headers: f.memberHeaders(studio) })

    const sendLink = (headers: Record<string, string>, clientId: string) =>
      f.send(clientsPath(`/${clientId}/send-set-password`), { body: {}, headers })

    test('AUTH-13 the member is mailed a single-use link worded by the studio\'s password_reset template', async () => {
      const studio = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const member = await f.memberAt(studio, 'forgetful')
      // The studio's own wording, so the mail can be traced to its template.
      await harness.db
        .update(schema.emailTemplates)
        .set({ subject: 'Set your password at our studio' })
        .where(and(eq(schema.emailTemplates.tenantId, studio.id), eq(schema.emailTemplates.slug, 'password_reset')))
      const before = mailsTo(member.email).length

      assert.deepEqual(f.expectStatus(await sendLink(admin.headers, member.id), 200), { sent: true })

      assert.equal(mailsTo(member.email).length, before + 1, 'exactly one mail')
      assert.equal(mailsTo(member.email).at(-1)!.subject, 'Set your password at our studio')
      const [logged] = await harness.db
        .select()
        .from(schema.emailLog)
        .where(and(eq(schema.emailLog.tenantId, studio.id), eq(schema.emailLog.recipientEmail, member.email)))
      assert.equal(logged?.templateSlug, 'password_reset')
      await f.expectAudit(studio, admin, `POST /api/v1${clientsPath(`/${member.id}/send-set-password`)}`, { table: 'clients', id: member.id })

      const token = await tokenFromLink(member.email)
      f.expectStatus(await setPassword(studio, token, 'a password of my own'), 200)
      f.expectStatus(await setPassword(studio, token, 'and another one'), 400, 'invalid_token')
    })

    test('AUTH-13 a blocked member, another studio\'s member and an instructor\'s request get no link', async () => {
      const studio = await f.freshStudio()
      const elsewhere = await f.freshStudio()
      const admin = await f.staffAt(studio, 'admin', 'admin')
      const teacher = await f.staffAt(studio, 'teacher', 'instructor')
      const outsider = await f.staffAt(elsewhere, 'admin', 'admin')
      const member = await f.memberAt(studio, 'member')
      const blocked = await f.memberAt(studio, 'blocked')
      f.expectStatus(await f.send(clientsPath(`/${blocked.id}`), { method: 'DELETE', headers: admin.headers }), 200)
      const auditBefore = (await f.auditRowsAt(studio)).length

      f.expectStatus(await sendLink(admin.headers, blocked.id), 409, 'client_blocked')
      f.expectStatus(await sendLink(outsider.headers, member.id), 404, 'client_not_found')
      f.expectStatus(await sendLink(teacher.headers, member.id), 403)

      assert.deepEqual(mailsTo(member.email), [])
      assert.deepEqual(mailsTo(blocked.email), [])
      assert.equal((await f.auditRowsAt(studio)).length, auditBefore, 'a refusal is not audited')
      assert.deepEqual(await f.auditRowsAt(elsewhere), [])
    })
  })
})
