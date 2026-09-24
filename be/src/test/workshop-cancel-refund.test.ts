import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, inTenantContext, SKIP_REASON, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

/**
 * Cancelling a Workshop refunds nobody, and its paid bookings stay refundable
 * afterwards (#272).
 *
 * Against a real database, because the whole of the bug lived in two queries:
 * the member page listed only `confirmed` workshop bookings, so the Refund
 * action vanished the moment the Workshop was cancelled, and the refund unwind
 * only touched `confirmed` bookings, so a refund issued afterwards would have
 * left the booking saying nothing came back.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('refunding a cancelled Workshop', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenantId!: string
  let fake!: StripeFake

  let schema: typeof import('../db/schema')
  let workshopPublishSvc: typeof import('../services/workshops/publish')
  let workshopDaysSvc: typeof import('../services/workshops/days')
  let workshopTiersSvc: typeof import('../services/workshops/tiers')
  let workshopCancelSvc: typeof import('../services/workshops/cancel')
  let workshopBookSvc: typeof import('../services/workshops/book')
  let refundsSvc: typeof import('../services/billing/refunds')

  let staffId!: string
  let roomId!: string
  let workshopId!: string
  let tierId!: string
  const clientIds: string[] = []
  const purchaseIds: string[] = []

  // Named per run, so a run that dies before its cleanup cannot collide with
  // the next one.
  const run = Date.now().toString(36)
  const NAME_PREFIX = `wscx-${run}`
  const DOMAIN = `wscx-${run}.test`

  /** A member who paid S$120 for the Workshop's tier, through a Purchase and one card payment. */
  async function paidMember(n: number): Promise<{ clientId: string; bookingId: string; intent: string }> {
    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId,
        email: `member-${n}@${DOMAIN}`,
        name: `Workshop Member ${n}`,
        phone: '+6580000000',
        authUserId: `auth_${NAME_PREFIX}_member_${n}`,
      })
      .returning()
    clientIds.push(client!.id)

    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId,
        clientId: client!.id,
        kind: 'workshop',
        totalSgd: '120.00',
        amountPaidSgd: '120.00',
        status: 'paid',
      })
      .returning({ id: schema.purchases.id })
    purchaseIds.push(purchase!.id)

    const intent = `pi_${NAME_PREFIX}_${n}`
    await harness.db.insert(schema.stripePayments).values({
      tenantId,
      paymentIntentId: intent,
      purchaseId: purchase!.id,
      amountSgd: '120.00',
      kind: 'workshop',
      clientId: client!.id,
      status: 'pending',
    })

    const booked = await workshopBookSvc.bookWorkshopPaid(tenantId, {
      clientId: client!.id,
      workshopId,
      workshopTierId: tierId,
      paymentIntentId: intent,
      purchaseId: purchase!.id,
      amountSgd: '120.00',
    })
    return { clientId: client!.id, bookingId: booked.bookingId, intent }
  }

  const bookingRow = async (id: string) => {
    const [r] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    return r!
  }

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    schema = await import('../db/schema')
    workshopPublishSvc = inTenantContext(await import('../services/workshops/publish'))
    workshopDaysSvc = inTenantContext(await import('../services/workshops/days'))
    workshopTiersSvc = inTenantContext(await import('../services/workshops/tiers'))
    workshopCancelSvc = inTenantContext(await import('../services/workshops/cancel'))
    workshopBookSvc = inTenantContext(await import('../services/workshops/book'))
    refundsSvc = inTenantContext(await import('../services/billing/refunds'))
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.reply('refunds.create', {})

    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
    assert.ok(location)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId, locationId: location.id, name: `${NAME_PREFIX} Room`, capacity: 20 })
      .returning()
    roomId = room!.id

    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: `instructor@${DOMAIN}`,
        name: 'Workshop Instructor',
        role: 'instructor',
        status: 'active',
        authUserId: `auth_${NAME_PREFIX}_instructor`,
      })
      .returning()
    // Leads the Workshop, and stands in for the staff member acting on it —
    // the acting role is passed to `cancelWorkshop` on its own.
    staffId = staff!.id

    const workshop = await workshopPublishSvc.createWorkshop(tenantId, {
      // Not "… Retreat": the isolation suite purges every workshop named so.
      name: `${NAME_PREFIX} Intensive`,
      locationId: location.id,
      mainInstructorId: staffId,
      mainInstructorPaySgd: 100,
      createdByStaffId: staffId,
    })
    workshopId = workshop.id
    const startsAt = new Date(Date.now() + 40 * DAY)
    const day = await workshopDaysSvc.createDay(tenantId, workshopId, {
      ord: 1,
      roomId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      basePriceSgd: '120.00',
      capacityOnline: 10,
    })
    tierId = (
      await workshopTiersSvc.createTier(tenantId, workshopId, {
        name: `${NAME_PREFIX} Full Pass`,
        regularPriceSgd: '120.00',
        ord: 1,
        dayIds: [day.id],
      })
    ).id
  })

  after(async () => {
    fake?.restore()
    if (!harness) return
    // A fixture that failed half-way leaves some of these unset; the pool is
    // closed regardless, or the run hangs on it.
    try {
      if (workshopId) {
        const workshop = sql`${workshopId}::uuid`
        await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'workshopId' = ${workshopId}`)
        if (clientIds.length > 0) {
          const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
          await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
          await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
          await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
        }
        await harness.db.execute(
          sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id = ${workshop})`,
        )
        await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id = ${workshop}`)
        await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id = ${workshop}`)
        await harness.db.execute(sql`DELETE FROM workshop_images WHERE workshop_id = ${workshop}`)
        await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id = ${workshop}`)
        await harness.db.execute(sql`DELETE FROM workshops WHERE id = ${workshop}`)
      }
      if (clientIds.length > 0) {
        const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
        await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
      }
      if (roomId) await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}::uuid`)
      if (staffId) {
        await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id = ${staffId}::uuid`)
        await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${staffId}::uuid`)
        await harness.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}::uuid`)
      }
    } finally {
      await harness.close()
    }
  })

  test('WSP-15, WSP-16 a paid booking cancelled with its Workshop is not refunded, stays refundable, and a later Refund returns the money and records it refunded', async () => {
    const refunded = await paidMember(1)
    const waiting = await paidMember(2)

    await workshopCancelSvc.cancelWorkshop(tenantId, workshopId, staffId, 'admin')

    // Cancelling the Workshop took the places and gave nobody anything back.
    for (const m of [refunded, waiting]) {
      const b = await bookingRow(m.bookingId)
      assert.equal(b.state, 'cancelled')
      assert.equal(b.refundOutcome, 'n_a')
    }
    assert.deepEqual(fake.callsTo('refunds.create'), [], 'cancelling a Workshop refunds nobody automatically')

    // The member page still offers the Refund.
    const [listed] = await refundsSvc.listWorkshopPurchases(tenantId, refunded.clientId)
    assert.equal(listed?.bookingId, refunded.bookingId)
    assert.equal(listed?.cancelled, true)
    assert.equal(listed?.refundable, true)
    const cancelledAt = (await bookingRow(refunded.bookingId)).cancelledAt

    await refundsSvc.issueWorkshopRefund({
      tenantId,
      clientId: refunded.clientId,
      bookingId: refunded.bookingId,
      reason: 'the workshop was cancelled',
      actorStaffId: staffId,
    })
    assert.deepEqual(
      fake.callsTo('refunds.create').map(call => (call.args[0] as { payment_intent: string }).payment_intent),
      [refunded.intent],
    )

    // The provider's `charge.refunded` does the rest.
    await refundsSvc.unwindRefund(refunded.intent)

    const after = await bookingRow(refunded.bookingId)
    assert.equal(after.state, 'cancelled')
    assert.equal(after.refundOutcome, 'stripe_refunded', 'the booking records that its money came back')
    assert.equal(after.cancelledAt?.getTime(), cancelledAt?.getTime(), 'it was cancelled when its Workshop was')
    const [purchase] = await harness.db
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.id, after.purchaseId!))
    assert.equal(purchase?.status, 'refunded')
    assert.deepEqual(
      await refundsSvc.listWorkshopPurchases(tenantId, refunded.clientId),
      [],
      'a refunded booking has nothing left to refund',
    )

    // The member nobody has refunded yet is untouched, and still refundable.
    assert.equal((await bookingRow(waiting.bookingId)).refundOutcome, 'n_a')
    const [stillListed] = await refundsSvc.listWorkshopPurchases(tenantId, waiting.clientId)
    assert.equal(stillListed?.bookingId, waiting.bookingId)
    assert.equal(stillListed?.refundable, true)
  })
})
