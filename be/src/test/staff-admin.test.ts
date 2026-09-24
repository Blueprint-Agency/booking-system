import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, count, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * An Admin running the studio's staff over real HTTP (#268): inviting,
 * editing, archiving and deleting, and what an Instructor is refused.
 *
 * Every test runs in a studio of its own, created the way the super portal
 * creates one, so how many admins it has and which invitations it holds are the
 * test's to state. Each change that succeeds is checked for its audit row too —
 * under the studio, naming the Admin who made it.
 */
describe('admins manage staff over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let withTenant!: typeof import('../db')['withTenant']
  let staffService!: typeof import('../services/auth/staff-archive')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let seedPolicy!: typeof import('../db/seed/policy')['seedPolicy']

  const run = Date.now().toString(36)
  let studios = 0
  // A fixed instant for every rule that reads the clock, invitation expiry above all.
  const NOW = new Date(Math.floor(Date.now() / MINUTE) * MINUTE)

  type Studio = { id: string; slug: string }
  type Role = 'admin' | 'instructor'
  type StaffFixture = { headers: Record<string, string>; id: string; email: string }
  type Reply = { status: number; body: any }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ withTenant } = await import('../db'))
    staffService = await import('../services/auth/staff-archive')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ seedPolicy } = await import('../db/seed/policy'))
  })

  after(async () => {
    await harness?.close()
  })

  const reply = async (res: Response): Promise<Reply> => {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (path: string, init: { body?: unknown; headers: Record<string, string>; method?: string }) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    )

  const expectStatus = (res: Reply, status: number, error?: string) => {
    assert.equal(res.status, status, JSON.stringify(res.body))
    if (error) assert.equal(res.body?.error, error, JSON.stringify(res.body))
    return res.body
  }

  const portalHeaders = (studio: Studio): Record<string, string> => ({
    'X-Tenant-Slug': studio.slug,
    Origin: frontendOrigin('staff', studio),
    'X-Forwarded-For': harnessAddress(),
  })

  /**
   * A studio of its own. Its first admin is only invited, so every active staff
   * member is one the test adds. Its policy row is seeded as the fixture
   * Tenants' is: an instructor's leave figures are read against the Leave Year
   * it holds, and provisioning does not write one yet.
   */
  const freshStudio = async (): Promise<Studio> => {
    const slug = `staff-admin-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Staff Admin Studio', adminEmail: `owner@${slug}.test` })
    await seedPolicy(harness.db, tenant)
    return { id: tenant.id, slug }
  }

  /** An active staff member of `studio` with `role`, signed in on its portal. Instructors get their profile too. */
  const staffAt = async (studio: Studio, name: string, role: Role): Promise<StaffFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, studio.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id, email }
  }

  const staffRow = async (studio: Studio, id: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, studio.id), eq(schema.staffUsers.id, id)))
    return row!
  }

  const staffByEmail = async (studio: Studio, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, studio.id), eq(schema.staffUsers.email, email)))
    return row ?? null
  }

  const invitationsAt = (studio: Studio) =>
    harness.db.select().from(schema.staffInvitations).where(eq(schema.staffInvitations.tenantId, studio.id))

  /** Every audit row the studio holds for `actor`, oldest first. */
  const auditRowsBy = (studio: Studio, actor: StaffFixture) =>
    harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, studio.id), eq(schema.auditLog.actorStaffId, actor.id)))
      .orderBy(schema.auditLog.createdAt)

  /** The one audit row for `action` by `actor` at `studio`, on `target`. */
  const expectAudit = async (studio: Studio, actor: StaffFixture, action: string, target: { table: string; id: string }) => {
    const rows = (await auditRowsBy(studio, actor)).filter(r => r.action === action && r.targetId === target.id)
    assert.equal(rows.length, 1, `one audit row for ${action} on ${target.id}: ${JSON.stringify(rows)}`)
    const [row] = rows
    assert.equal(row!.tenantId, studio.id)
    assert.equal(row!.actorType, 'staff')
    assert.equal(row!.targetTable, target.table)
    assert.equal(row!.targetId, target.id)
    return row!
  }

  /** The set-password link in the newest mail to `email`. */
  const invitationToken = (email: string) => {
    const mails = discardedMail.filter(m => m.to === email)
    assert.ok(mails.length > 0, `no mail was sent to ${email}`)
    const match = mails.at(-1)!.html.match(/\/signup\?[^"'\s<]*invite_token=([A-Za-z0-9_-]+)/)
    assert.ok(match, 'the mail carries no set-password link')
    return match[1]!
  }

  const lookupInvitation = (studio: Studio, token: string) =>
    send(`/public/staff-invitation?token=${token}`, { headers: portalHeaders(studio) })

  const acceptInvitation = (studio: Studio, token: string) =>
    send('/public/staff-invitation/accept', { body: { token, password: 'a password of their own' }, headers: portalHeaders(studio) })

  const me = (headers: Record<string, string>) => send('/portal/auth/me', { headers })

  const staffPath = (id = '') => `/portal/admin/staff${id ? `/${id}` : ''}`

  test('STF-01 an admin invites an email as instructor or admin, and the link is valid for 7 days at this studio', async () => {
    harness.clock.set(NOW)
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')

    for (const role of ['instructor', 'admin'] as const) {
      const email = `invited-${role}@${studio.slug}.test`
      const invited = expectStatus(
        await send(`${staffPath()}/invite`, { body: { email, role }, headers: admin.headers }),
        201,
      )
      assert.equal(invited.email, email)
      assert.equal(invited.role, role)
      assert.equal(invited.status, 'pending')
      assert.equal(new Date(invited.expires_at).getTime(), NOW.getTime() + 7 * DAY, 'the link lasts exactly 7 days')

      const [invitation] = (await invitationsAt(studio)).filter(i => i.id === invited.id)
      assert.equal(invitation?.role, role)
      assert.equal(invitation?.invitedByStaffId, admin.id)
      const row = await staffByEmail(studio, email)
      assert.equal(row?.role, role)
      assert.equal(row?.status, 'pending')

      // The mailed link opens at this studio, on the last minute of its seventh day.
      const token = invitationToken(email)
      harness.clock.set(new Date(NOW.getTime() + 7 * DAY - MINUTE))
      assert.equal(expectStatus(await lookupInvitation(studio, token), 200).status, 'valid')
      harness.clock.set(NOW)

      await expectAudit(studio, admin, `POST /api/v1${staffPath()}/invite`, { table: 'staff_invitations', id: invited.id })
    }

    // The listing shows both as pending invitations, beside the first admin's own.
    const listed = expectStatus(await send(staffPath(), { headers: admin.headers }), 200)
    assert.deepEqual(
      listed.invitations
        .filter((i: { email: string }) => i.email.startsWith('invited-'))
        .map((i: { email: string; role: string }) => `${i.role}:${i.email}`)
        .sort(),
      [`admin:invited-admin@${studio.slug}.test`, `instructor:invited-instructor@${studio.slug}.test`],
    )
  })

  test('STF-05 an invitation older than 7 days is refused when opened, and stays pending', async () => {
    harness.clock.set(NOW)
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const email = `late@${studio.slug}.test`
    const invited = expectStatus(await send(`${staffPath()}/invite`, { body: { email, role: 'instructor' }, headers: admin.headers }), 201)
    const token = invitationToken(email)

    harness.clock.set(new Date(NOW.getTime() + 7 * DAY + MINUTE))
    assert.equal(expectStatus(await lookupInvitation(studio, token), 200).status, 'expired')
    expectStatus(await acceptInvitation(studio, token), 409, 'invitation_expired')

    const [invitation] = (await invitationsAt(studio)).filter(i => i.id === invited.id)
    assert.equal(invitation?.status, 'pending')
    assert.equal(invitation?.acceptedAt, null)
    assert.equal((await staffByEmail(studio, email))?.status, 'pending')
    harness.clock.set(NOW)
  })

  test('STF-06 inviting an email that is already a staff account is refused: one email is one staff account', async () => {
    harness.clock.set(NOW)
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const existing = await staffAt(studio, 'teacher', 'instructor')
    const pending = `pending@${studio.slug}.test`
    expectStatus(await send(`${staffPath()}/invite`, { body: { email: pending, role: 'instructor' }, headers: admin.headers }), 201)
    const invitationsBefore = (await invitationsAt(studio)).length
    const auditBefore = (await auditRowsBy(studio, admin)).length

    for (const email of [existing.email, existing.email.toUpperCase(), pending]) {
      expectStatus(
        await send(`${staffPath()}/invite`, { body: { email, role: 'admin' }, headers: admin.headers }),
        409,
        'email_in_use',
      )
    }
    assert.equal((await invitationsAt(studio)).length, invitationsBefore, 'no invitation was written')
    assert.equal((await staffRow(studio, existing.id)).role, 'instructor', 'the account is untouched')
    assert.equal((await auditRowsBy(studio, admin)).length, auditBefore, 'a refusal is not audited')
  })

  test('STF-07 an admin edits a staff profile, leave figures included', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')

    const edited = expectStatus(
      await send(staffPath(teacher.id), {
        method: 'PATCH',
        body: {
          first_name: 'Grace',
          last_name: 'Hopper',
          phone: '+6591112222',
          bio: 'Vinyasa and yin.',
          annual_leave_days: 14,
          medical_leave_days: 10,
          study_leave_days: 3,
        },
        headers: admin.headers,
      }),
      200,
    )
    assert.equal(edited.name, 'Grace Hopper')
    assert.equal(edited.bio, 'Vinyasa and yin.')
    assert.deepEqual(
      [edited.annual_leave_days, edited.medical_leave_days, edited.study_leave_days],
      [14, 10, 3],
    )

    const row = await staffRow(studio, teacher.id)
    assert.deepEqual([row.firstName, row.lastName, row.name, row.phone, row.bio], ['Grace', 'Hopper', 'Grace Hopper', '+6591112222', 'Vinyasa and yin.'])
    const [profile] = await harness.db.select().from(schema.instructors).where(eq(schema.instructors.staffUserId, teacher.id))
    assert.deepEqual([profile!.annualLeaveDays, profile!.medicalLeaveDays, profile!.studyLeaveDays], [14, 10, 3])
    await expectAudit(studio, admin, `PATCH /api/v1${staffPath(teacher.id)}`, { table: 'staff_users', id: teacher.id })

    // The staff page lists the edit back.
    const listed = expectStatus(await send(staffPath(), { headers: admin.headers }), 200)
    const listedTeacher = listed.staff.find((s: { id: string }) => s.id === teacher.id)
    assert.equal(listedTeacher.name, 'Grace Hopper')
    assert.equal(listedTeacher.annual_leave_days, 14)
  })

  test('STF-08 an instructor editing their bio changes only their own row, whatever id the body names', async () => {
    const studio = await freshStudio()
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const colleague = await staffAt(studio, 'colleague', 'instructor')
    const colleagueBefore = await staffRow(studio, colleague.id)

    const edited = expectStatus(
      await send('/portal/instructor/profile', {
        method: 'PATCH',
        body: { id: colleague.id, staff_user_id: colleague.id, bio: 'My own words.' },
        headers: teacher.headers,
      }),
      200,
    )
    assert.equal(edited.id, teacher.id)
    assert.equal(edited.bio, 'My own words.')
    assert.equal((await staffRow(studio, teacher.id)).bio, 'My own words.')
    assert.deepEqual(await staffRow(studio, colleague.id), colleagueBefore, "the colleague's row is untouched")
    await expectAudit(studio, teacher, 'PATCH /api/v1/portal/instructor/profile', { table: 'instructors', id: teacher.id })
  })

  test('STF-09 archiving ends the staff member\'s sessions at once, and invitations they sent stay valid', async () => {
    harness.clock.set(NOW)
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const leaver = await staffAt(studio, 'leaver', 'admin')
    const invitee = `their-invitee@${studio.slug}.test`
    expectStatus(await send(`${staffPath()}/invite`, { body: { email: invitee, role: 'instructor' }, headers: leaver.headers }), 201)
    const token = invitationToken(invitee)
    const secondSession = await harness.signInAs('staff', leaver.email, studio)
    expectStatus(await me(leaver.headers), 200)

    const archived = expectStatus(await send(`${staffPath(leaver.id)}/archive`, { body: {}, headers: admin.headers }), 200)
    assert.equal(archived.status, 'archived')

    expectStatus(await me(leaver.headers), 401, 'invalid_token')
    expectStatus(await me(secondSession), 401, 'invalid_token')
    const sessions = expectStatus(await send(`${staffPath(leaver.id)}/sessions`, { headers: admin.headers }), 200)
    assert.deepEqual(sessions.sessions, [], 'no session of theirs is left at the studio')
    const row = await staffRow(studio, leaver.id)
    assert.equal(row.status, 'archived')
    assert.equal(row.archivedByStaffId, admin.id)
    await expectAudit(studio, admin, `POST /api/v1${staffPath(leaver.id)}/archive`, { table: 'staff_users', id: leaver.id })

    // The person they invited still gets in.
    assert.equal(expectStatus(await lookupInvitation(studio, token), 200).status, 'valid')
    expectStatus(await acceptInvitation(studio, token), 200)
    assert.equal((await staffByEmail(studio, invitee))?.status, 'active')
  })

  test('STF-11 deleting a staff account that is not archived is refused, and deleting an archived one soft-deletes it', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const auditBefore = (await auditRowsBy(studio, admin)).length

    expectStatus(await send(staffPath(teacher.id), { method: 'DELETE', headers: admin.headers }), 400, 'staff_not_archived')
    let row = await staffRow(studio, teacher.id)
    assert.equal(row.deletedAt, null)
    assert.equal(row.status, 'active')
    assert.equal((await auditRowsBy(studio, admin)).length, auditBefore, 'a refusal is not audited')

    expectStatus(await send(`${staffPath(teacher.id)}/archive`, { body: {}, headers: admin.headers }), 200)
    const deleted = await harness.app.request(`/api/v1${staffPath(teacher.id)}`, { method: 'DELETE', headers: admin.headers })
    assert.equal(deleted.status, 204, await deleted.text())

    row = await staffRow(studio, teacher.id)
    assert.ok(row, 'the row stays, so the audit trail can still name them')
    assert.ok(row.deletedAt, 'and is marked deleted')
    await expectAudit(studio, admin, `DELETE /api/v1${staffPath(teacher.id)}`, { table: 'staff_users', id: teacher.id })
    const listed = expectStatus(await send(staffPath(), { headers: admin.headers }), 200)
    assert.ok(!listed.staff.some((s: { id: string }) => s.id === teacher.id), 'a deleted account leaves the staff list')
  })

  describe('STF-12 an instructor still teaching cannot be archived, from the instructor profile or the Staff page (#249)', () => {
    /** An instructor on an upcoming class and a workshop, with a location, room and class type to hang them on. */
    const teachingInstructor = async () => {
      harness.clock.set(NOW)
      const studio = await freshStudio()
      const admin = await staffAt(studio, 'admin', 'admin')
      const teacher = await staffAt(studio, 'teacher', 'instructor')
      const [location] = await harness.db.insert(schema.locations).values({ tenantId: studio.id, name: 'Main hall' }).returning()
      const [room] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: studio.id, locationId: location!.id, name: 'Room 1', capacity: 20 })
        .returning()
      const [classType] = await harness.db.insert(schema.classTypes).values({ tenantId: studio.id, name: 'Hatha' }).returning()
      const klass = async (startsAt: Date) => {
        const [row] = await harness.db
          .insert(schema.classes)
          .values({
            tenantId: studio.id,
            classTypeId: classType!.id,
            mainInstructorId: teacher.id,
            locationId: location!.id,
            roomId: room!.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + HOUR),
            capacityOnline: 10,
            creditCost: 1,
            createdByStaffId: admin.id,
          })
          .returning()
        return row!.id
      }
      // Finished yesterday: not what stands in the way.
      await klass(new Date(NOW.getTime() - DAY))
      const upcomingClassId = await klass(new Date(NOW.getTime() + 2 * DAY))
      const [workshop] = await harness.db
        .insert(schema.workshops)
        .values({ tenantId: studio.id, name: 'Inversions', locationId: location!.id, createdByStaffId: admin.id })
        .returning()
      await harness.db
        .insert(schema.workshopInstructors)
        .values({ tenantId: studio.id, workshopId: workshop!.id, instructorId: teacher.id, role: 'main' })
      return { studio, admin, teacher, upcomingClassId, workshopId: workshop!.id }
    }

    for (const [door, path] of [
      ['the Staff page', (id: string) => `${staffPath(id)}/archive`],
      ['the instructor profile', (id: string) => `/portal/admin/instructors/${id}/archive`],
    ] as const) {
      test(`STF-12 refused from ${door}, naming the class and the workshop`, async () => {
        const { studio, admin, teacher, upcomingClassId, workshopId } = await teachingInstructor()
        const auditBefore = (await auditRowsBy(studio, admin)).length

        const refused = expectStatus(await send(path(teacher.id), { body: {}, headers: admin.headers }), 409, 'instructor_in_use')
        assert.deepEqual(refused.class_ids, [upcomingClassId])
        assert.deepEqual(refused.workshop_ids, [workshopId])
        assert.deepEqual(refused.pt_session_ids, [])

        const row = await staffRow(studio, teacher.id)
        assert.equal(row.status, 'active')
        assert.equal(row.archivedAt, null)
        expectStatus(await me(teacher.headers), 200)
        assert.equal((await auditRowsBy(studio, admin)).length, auditBefore, 'a refusal is not audited')
      })
    }

    test('STF-12 once the class is over and the workshop cancelled, the Staff page archives them', async () => {
      const { studio, admin, teacher, workshopId } = await teachingInstructor()
      await harness.db
        .update(schema.workshops)
        .set({ lifecycle: 'cancelled', cancelledAt: NOW, cancelledByStaffId: admin.id })
        .where(eq(schema.workshops.id, workshopId))
      harness.clock.set(new Date(NOW.getTime() + 3 * DAY))

      const archived = expectStatus(await send(`${staffPath(teacher.id)}/archive`, { body: {}, headers: admin.headers }), 200)
      assert.equal(archived.status, 'archived')
      await expectAudit(studio, admin, `POST /api/v1${staffPath(teacher.id)}/archive`, { table: 'staff_users', id: teacher.id })
      harness.clock.set(NOW)
    })
  })

  test('STF-15 the only active admin cannot be archived or demoted by anyone, and is told to promote someone first', async () => {
    const studio = await freshStudio()
    const onlyAdmin = await staffAt(studio, 'only-admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const inStudio = <T>(fn: () => Promise<T>) => withTenant(studio.id, fn)
    const refusedWith = (code: string) => (err: { code?: string; details?: { message?: string } }) => {
      assert.equal(err.code, code)
      assert.match(err.details?.message ?? '', /promote someone else to admin/i)
      return true
    }

    // Over HTTP the actor is always an active admin other than the target, so
    // a studio with one admin is reached at the service, as any caller would.
    await assert.rejects(
      inStudio(() => staffService.archiveStaff({ tenantId: studio.id, targetStaffId: onlyAdmin.id, actorStaffId: teacher.id })),
      refusedWith('cannot_archive_last_admin'),
    )
    // The rank rule refuses an instructor's role change before the count is
    // read, so the demotion is attempted by an archived admin: of a rank that
    // may change roles, and not counted among the studio's active admins.
    const archivedAdmin = await staffAt(studio, 'archived-admin', 'admin')
    await harness.db
      .update(schema.staffUsers)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(schema.staffUsers.id, archivedAdmin.id))
    await assert.rejects(
      inStudio(() =>
        staffService.updateStaffProfile({
          tenantId: studio.id,
          targetStaffId: onlyAdmin.id,
          actorStaffId: archivedAdmin.id,
          patch: { role: 'instructor' },
        }),
      ),
      refusedWith('cannot_demote_last_admin'),
    )

    const row = await staffRow(studio, onlyAdmin.id)
    assert.equal(row.status, 'active')
    assert.equal(row.role, 'admin')
    expectStatus(await me(onlyAdmin.headers), 200)
  })

  test('STF-17 an instructor is refused 403 on the admin-only portal routes, and nothing changes', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const [pkg] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name: 'Ten classes', kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00' })
      .returning()

    const countOf = async (table: typeof schema.classPackages | typeof schema.workshops | typeof schema.classSeries | typeof schema.staffInvitations) =>
      (await harness.db.select({ n: count() }).from(table).where(eq(table.tenantId, studio.id)))[0]!.n
    const snapshot = async () => ({
      packages: await countOf(schema.classPackages),
      workshops: await countOf(schema.workshops),
      series: await countOf(schema.classSeries),
      invitations: await countOf(schema.staffInvitations),
      policy: await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, studio.id)),
      pkg: (await harness.db.select().from(schema.classPackages).where(eq(schema.classPackages.id, pkg!.id)))[0],
      admin: await staffRow(studio, admin.id),
    })
    const before = await snapshot()

    const attempts: Array<[string, string, unknown]> = [
      ['POST', '/portal/admin/class-packages', { name: 'Sneaky', kind: 'credit_bundle', credits: 5, validity_days: 30, price_sgd: '1.00' }],
      ['PATCH', `/portal/admin/class-packages/${pkg!.id}`, { price_sgd: '1.00' }],
      ['POST', `/portal/admin/class-packages/${pkg!.id}/archive`, {}],
      ['POST', '/portal/admin/workshops', { name: 'Sneaky workshop' }],
      ['PATCH', '/portal/admin/policy/global', { cancellation_window_hours: 0 }],
      ['POST', `${staffPath()}/invite`, { email: `sneaky@${studio.slug}.test`, role: 'admin' }],
      ['POST', `${staffPath(admin.id)}/archive`, {}],
      ['POST', '/portal/admin/schedule/series', { class_type_id: pkg!.id }],
    ]
    for (const [method, path, body] of attempts) {
      const res = await send(path, { method, body, headers: teacher.headers })
      assert.equal(res.status, 403, `${method} ${path}: ${JSON.stringify(res.body)}`)
    }

    assert.deepEqual(await snapshot(), before)
    assert.deepEqual(await auditRowsBy(studio, teacher), [], 'a refused request writes no audit row')
  })

  test("STF-19 an instructor cannot edit an admin's account, over HTTP or at the service", async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const before = await staffRow(studio, admin.id)

    expectStatus(await send(staffPath(admin.id), { method: 'PATCH', body: { bio: 'Written by someone else' }, headers: teacher.headers }), 403)
    await assert.rejects(
      withTenant(studio.id, () =>
        staffService.updateStaffProfile({
          tenantId: studio.id,
          targetStaffId: admin.id,
          actorStaffId: teacher.id,
          patch: { bio: 'Written by someone else', phone: '+6500000000' },
        }),
      ),
      (err: { code?: string }) => {
        assert.equal(err.code, 'outranked_staff_edit_forbidden')
        return true
      },
    )
    assert.deepEqual(await staffRow(studio, admin.id), before)
  })

  test('STF-20 a request from an instructor carrying a role change is refused, for themselves or anyone', async () => {
    const studio = await freshStudio()
    await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const colleague = await staffAt(studio, 'colleague', 'instructor')

    // Their own profile route: the role rides along with an edit they may make.
    expectStatus(
      await send('/portal/instructor/profile', { method: 'PATCH', body: { bio: 'Now in charge', role: 'admin' }, headers: teacher.headers }),
      400,
    )
    // The staff routes.
    for (const target of [teacher, colleague]) {
      expectStatus(await send(staffPath(target.id), { method: 'PATCH', body: { role: 'admin' }, headers: teacher.headers }), 403)
    }
    // And the service behind them, which refuses the field whoever it names.
    for (const target of [teacher, colleague]) {
      await assert.rejects(
        withTenant(studio.id, () =>
          staffService.updateStaffProfile({
            tenantId: studio.id,
            targetStaffId: target.id,
            actorStaffId: teacher.id,
            patch: { role: 'admin', bio: 'Now in charge' },
          }),
        ),
        (err: { code?: string }) => {
          assert.equal(err.code, 'privilege_fields_admin_only')
          return true
        },
      )
    }

    for (const target of [teacher, colleague]) {
      const row = await staffRow(studio, target.id)
      assert.equal(row.role, 'instructor')
      assert.equal(row.bio, null, 'nothing else in the refused request was written either')
    }
    expectStatus(await send(staffPath(), { headers: teacher.headers }), 403)
  })

  test("another studio's admin reaches none of this studio's staff or invitations", async () => {
    harness.clock.set(NOW)
    const studio = await freshStudio()
    const elsewhere = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const outsider = await staffAt(elsewhere, 'admin', 'admin')
    const invited = expectStatus(
      await send(`${staffPath()}/invite`, { body: { email: `pending@${studio.slug}.test`, role: 'instructor' }, headers: admin.headers }),
      201,
    )
    const teacherBefore = await staffRow(studio, teacher.id)

    const attempts: Array<[string, string, unknown]> = [
      ['PATCH', staffPath(teacher.id), { bio: 'Not yours' }],
      ['POST', `${staffPath(teacher.id)}/archive`, {}],
      ['POST', `${staffPath(teacher.id)}/sessions/revoke`, {}],
      ['DELETE', staffPath(teacher.id), undefined],
      ['POST', `${staffPath()}/invitations/${invited.id}/revoke`, {}],
      ['POST', `${staffPath()}/invitations/${invited.id}/resend`, {}],
    ]
    for (const [method, path, body] of attempts) {
      const res = await send(path, { method, body, headers: outsider.headers })
      assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`)
    }
    // Their session presented at this studio's portal is no session here.
    expectStatus(await send(staffPath(), { headers: { ...outsider.headers, ...portalHeaders(studio) } }), 401)

    assert.deepEqual(await staffRow(studio, teacher.id), teacherBefore)
    const [invitation] = (await invitationsAt(studio)).filter(i => i.id === invited.id)
    assert.equal(invitation?.status, 'pending')
    assert.deepEqual(await auditRowsBy(elsewhere, outsider), [])
    assert.deepEqual(await auditRowsBy(studio, outsider), [])
  })
})
