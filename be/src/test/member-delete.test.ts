import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Row, type Staff, type Tenant } from './member-fixtures'
import { MEMBER_TABLES, eraseSteps, type MemberKey } from '../services/clients/member-tables'
import type { StripeFake } from './stripe-fake'

/**
 * A studio permanently deletes a member (#144).
 *
 * The fixture is the export test's (`member-fixtures.ts`): a row in every table
 * `MEMBER_TABLES` lists, for the member, for another member of the same studio,
 * and for the same person as a member of the second studio. Two members are
 * deleted: one who belongs to both studios, and one who belongs to this studio
 * alone. Logins are per studio (#231), so each loses this studio's login, and
 * the first keeps the separate login they have at the second studio.
 */
describe('member delete', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let stripe: StripeFake | undefined
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: Tenant
  let two!: Tenant

  const DOMAIN = `member-delete-${Date.now().toString(36)}.test`
  const PHONE = '+6591234567'

  type Member = MemberKey & { headers: Record<string, string>; email: string }

  let admin!: Staff
  let instructor!: Staff
  /** A member of both studios. */
  let member!: Member
  /** The same person at the second studio. */
  let elsewhere!: Member
  /** A member of this studio alone. */
  let solo!: Member
  let neighbour!: Member
  let memberRows!: Map<string, Row>
  /** The neighbour's 2-on-1 request, naming the member as partner. */
  let partnerRequest!: Row
  /** A PT session scheduled from the member's own request. */
  let requestedSession!: Row

  const deletePath = (clientId: string) => `/api/v1/portal/admin/clients/${clientId}/permanently`
  const remove = (clientId: string, headers: Record<string, string>) =>
    harness.app.request(deletePath(clientId), { method: 'DELETE', headers })

  /** How many rows in each listed table name `m` at `tenant`. */
  const rowsNaming = async (tenant: Tenant, m: MemberKey) => {
    const counts: Record<string, number> = {}
    for (const entry of MEMBER_TABLES) {
      const [row] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(entry.table)} WHERE tenant_id = ${tenant.id} AND ${entry.where(m)}`,
      )
      counts[entry.table] = row!.n
    }
    return counts
  }

  before(async () => {
    harness = await startTestApp()
    // Deletion asks the payment provider to forget the member's Customer
    // (#185). Without the fake that is a real network call per fixture — caught
    // and logged, so the suite would still pass, but every run would wait out
    // the vendor deadline for nothing.
    //
    // Imported **here**, not at the top: `stripe-fake` pulls in `lib/stripe`,
    // which reads the environment at module load. A static import would freeze
    // it before `startTestApp` has finished writing it, and the first thing to
    // notice is staff sign-in failing with a 500.
    stripe = (await import('./stripe-fake')).installStripeFake()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    const { at, staffAt, memberAt, fixturesFor, insertRow } = fixtures
    ;({ one, two } = harness.tenants)
    admin = await staffAt(one, at('admin'), 'admin')
    instructor = await staffAt(one, at('instructor'), 'instructor')
    const adminTwo = await staffAt(two, at('admin-two'), 'admin')

    const join = async (tenant: Tenant, by: Staff, name: string): Promise<Member> => ({
      ...(await memberAt(tenant, by.headers, at(name))),
      email: at(name),
    })
    member = await join(one, admin, 'member')
    elsewhere = await join(two, adminTwo, 'member')
    assert.notEqual(elsewhere.authUserId, member.authUserId, 'a login at each studio')
    solo = await join(one, admin, 'solo')
    neighbour = await join(one, admin, 'neighbour')

    memberRows = await fixturesFor(one.id, member)
    await fixturesFor(one.id, solo)
    const neighbourRows = await fixturesFor(one.id, neighbour)
    await fixturesFor(two.id, elsewhere)

    partnerRequest = await insertRow('pt_requests', one.id, {
      client_id: neighbour.clientId,
      class_type_id: neighbourRows.get('pt_requests')!.class_type_id,
      location_id: neighbourRows.get('pt_requests')!.location_id,
      session_type: '2on1',
      co_client_id: member.clientId,
    })
    requestedSession = await insertRow('pt_sessions', one.id, {
      ...(({ id, pt_request_id, ...rest }) => rest)(memberRows.get('pt_sessions')!),
      pt_request_id: memberRows.get('pt_requests')!.id,
    })

    // The rows that name a member without their id in a column of its own: mail
    // sent to an address before it had an account, a staff action on their
    // package, an action taken while impersonating them.
    for (const m of [member, neighbour]) {
      await insertRow('email_log', one.id, { recipient_user_kind: 'client', recipient_user_id: null, recipient_email: m.email })
      await insertRow('audit_log', one.id, {
        actor_type: 'staff',
        target_table: 'client_packages',
        action: `POST /api/v1/portal/admin/clients/${m.clientId}/credits/adjust`,
      })
      await insertRow('audit_log', one.id, { actor_type: 'staff', target_table: 'bookings', payload: { impersonatedClientId: m.clientId } })
    }
  })

  after(async () => {
    stripe?.restore()
    if (!harness) return
    await fixtures?.cleanup()
    await harness.close()
  })

  test('an instructor cannot delete a member', async () => {
    assert.equal((await remove(member.clientId, instructor.headers)).status, 403)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, member.clientId))
    assert.ok(row, 'a refused delete removed the member')
  })

  describe('a member of two studios, deleted at one', () => {
    let before!: { neighbour: Record<string, number>; elsewhere: Record<string, number>; solo: Record<string, number> }

    test('is deleted', async () => {
      before = {
        neighbour: await rowsNaming(one, neighbour),
        elsewhere: await rowsNaming(two, elsewhere),
        solo: await rowsNaming(one, solo),
      }
      const res = await remove(member.clientId, admin.headers)
      assert.equal(res.status, 200, await res.clone().text())
    })

    test('no row at the studio names them any more', async () => {
      const left = await rowsNaming(one, member)
      assert.deepEqual(Object.entries(left).filter(([, n]) => n > 0), [])
    })

    test('the accounting rows stay, and hold no name, email or phone', async () => {
      // The member's own rows that deletion keeps: those found by their client id
      // and cleared rather than deleted.
      //
      // Written out rather than derived twice, so a table that starts being kept
      // has to be named here on purpose — the list is the assertion. `purchases`
      // joined it when a Purchase learned to outlive its member (#144 × #91);
      // `payment_customers` deliberately did **not**, because it is deleted, not
      // emptied (#185): the studio's accounts keep money, not the member's
      // identity at a third party.
      const kept = MEMBER_TABLES.filter(
        e => e.columns.join() === 'client_id' && eraseSteps(e).some(s => 'keptBecause' in s),
      ).map(e => e.table)
      assert.deepEqual(kept, [
        'client_packages',
        'purchases',
        'stripe_payments',
        'promo_code_redemptions',
        'merch_orders',
      ])
      for (const table of kept) {
        const [row] = await harness.db.execute<Row>(
          sql`SELECT * FROM ${sql.identifier(table)} WHERE id = ${memberRows.get(table)!.id}`,
        )
        assert.ok(row, `${table}: the member's row was deleted, not kept`)
        assert.equal(row.client_id, null, `${table}: still names the member`)
        const text = JSON.stringify(row)
        for (const personal of ['Ada Lovelace', member.email, PHONE, member.clientId, member.authUserId]) {
          assert.ok(!text.includes(personal), `${table} still holds ${personal}: ${text}`)
        }
      }
      const [payment] = await harness.db.execute<Row>(
        sql`SELECT receipt_url, booking_id FROM stripe_payments WHERE id = ${memberRows.get('stripe_payments')!.id}`,
      )
      assert.deepEqual(payment, { receipt_url: null, booking_id: null })
    })

    test('what is someone else’s stays theirs: a partner’s request, and a session scheduled from the member’s request', async () => {
      const [request] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, String(partnerRequest.id)))
      assert.ok(request, 'the partner’s request was deleted')
      assert.equal(request.clientId, neighbour.clientId)
      assert.equal(request.coClientId, null)

      const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, String(requestedSession.id)))
      assert.ok(session, 'the instructor’s session was deleted')
      assert.equal(session.ptRequestId, null)
    })

    test('every other member, and the other studio, is untouched', async () => {
      assert.deepEqual(await rowsNaming(one, neighbour), before.neighbour)
      assert.deepEqual(await rowsNaming(one, solo), before.solo)
      assert.deepEqual(await rowsNaming(two, elsewhere), before.elsewhere)
    })

    test('their sessions and login here end; their login at the other studio still signs in', async () => {
      const here = await harness.db
        .select()
        .from(schema.clientAuthSessions)
        .where(and(eq(schema.clientAuthSessions.userId, member.authUserId), eq(schema.clientAuthSessions.claimedTenantId, one.id)))
      assert.deepEqual(here, [])
      assert.equal((await harness.app.request('/api/v1/me', { headers: member.headers })).status, 401)

      const loginHere = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.id, member.authUserId))
      assert.deepEqual(loginHere, [], "this studio's login for them is deleted")
      const [loginThere] = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.id, elsewhere.authUserId))
      assert.ok(loginThere, "the other studio's login is untouched")
      assert.equal((await harness.app.request('/api/v1/me', { headers: elsewhere.headers })).status, 200)
      const again = await harness.signInAs('client', elsewhere.email, two)
      assert.equal((await harness.app.request('/api/v1/me', { headers: again })).status, 200)
    })

    test('the deletion is a staff act that does not name the member', async () => {
      const events = await harness.db
        .select()
        .from(schema.authEvents)
        .where(and(eq(schema.authEvents.tenantId, one.id), eq(schema.authEvents.kind, 'member_deleted')))
      const mine = events.filter(e => e.actorUserId === admin.authUserId)
      assert.equal(mine.length, 1)
      assert.equal(mine[0]!.pool, 'staff')
      assert.equal(mine[0]!.subjectUserId, null)

      const audit = await harness.db.execute<Row>(
        sql`SELECT * FROM audit_log WHERE tenant_id = ${one.id} AND actor_staff_id = ${admin.row.id}`,
      )
      assert.ok(
        audit.some(row => row.action === 'DELETE /api/v1/portal/admin/clients/:id/permanently'),
        `the deletion was not audited by its route: ${JSON.stringify(audit.map(r => r.action))}`,
      )
      for (const row of audit) {
        assert.ok(!JSON.stringify(row).includes(member.clientId), `audit_log names the member: ${JSON.stringify(row)}`)
      }
    })

    test('a second delete is a clean 404', async () => {
      const res = await remove(member.clientId, admin.headers)
      assert.equal(res.status, 404)
    })
  })

  test('a member of this studio alone takes their sign-in account with them', async () => {
    const res = await remove(solo.clientId, admin.headers)
    assert.equal(res.status, 200, await res.clone().text())
    const account = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.id, solo.authUserId))
    assert.deepEqual(account, [])
    assert.deepEqual(Object.entries(await rowsNaming(one, solo)).filter(([, n]) => n > 0), [])
  })

  test('a member of another studio is not found here', async () => {
    assert.equal((await remove(elsewhere.clientId, admin.headers)).status, 404)
  })
})
