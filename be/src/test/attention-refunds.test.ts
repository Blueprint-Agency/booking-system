import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { connectPayments, usePaymentKey } from './attention-payments'
import { ownAccountId, stripeWebhookPath, type StripeFake } from './stripe-fake'

/**
 * Staff attention, refunds (#476, #485): three Needs-action items for refunds
 * that need an admin. `refund_incomplete` (a refund stopped part-way) and
 * `refund_unconfirmed` (Stripe has not confirmed one after a day) read the
 * existing refund-progress and in-flight rules; `workshop_cancelled_unrefunded`
 * is a paid place in a cancelled workshop nobody refunded, and is dismissable.
 *
 * Every refund here is issued through the real refund routes against the Stripe
 * stub, and settled by the real `charge.refunded` webhook.
 */
describe('Staff attention: refunds', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let withTenant!: typeof import('../db').withTenant
  let fake!: StripeFake
  let workshopsSvc!: {
    publish: typeof import('../services/workshops/publish')
    days: typeof import('../services/workshops/days')
    tiers: typeof import('../services/workshops/tiers')
    book: typeof import('../services/workshops/book')
    cancel: typeof import('../services/workshops/cancel')
  }

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }
  type Member = { clientId: string; name: string }

  let studios = 0

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const freshStudio = async (): Promise<Studio> => {
    const slug = `rfa-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Refund Attention Studio', adminEmail: `owner@${slug}.test` })
    fake.ownAccount({ id: tenant.id, slug })
    await connectPayments(tenant.id)
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id, name }
  }

  const memberAt = async (studio: Studio, name: string): Promise<Member> => {
    const email = `${name.toLowerCase().replace(/\s+/g, '-')}@${studio.slug}.test`
    await harness.signInAs('client', email, studio)
    const [user] = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, name }
  }

  /** A bundle "Ten pass" bought in one Purchase, settled by one succeeded payment per amount. */
  const paidPackage = async (studio: Studio, who: Member, amounts: string[]) => {
    const total = amounts.reduce((sum, a) => sum + Number(a), 0).toFixed(2)
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'class_package',
        totalSgd: total,
        amountPaidSgd: total,
        status: 'paid',
        metadata: { item_name: 'Ten pass' },
      })
      .returning({ id: schema.purchases.id })
    const intents = amounts.map(() => `pi_rfa_${randomUUID().slice(0, 12)}`)
    for (const [i, amount] of amounts.entries()) {
      await harness.db.insert(schema.stripePayments).values({
        tenantId: studio.id,
        paymentIntentId: intents[i]!,
        purchaseId: purchase!.id,
        amountSgd: amount,
        kind: 'class_package',
        clientId: who.clientId,
        status: 'succeeded',
        providerAccountId: ownAccountId(studio),
      })
    }
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        validityDays: 90,
        creditsOrSessionsRemaining: 10,
        amountPaidSgd: total,
        listPriceSgd: total,
        purchaseId: purchase!.id,
      })
      .returning({ id: schema.clientPackages.id })
    return { purchaseId: purchase!.id, clientPackageId: pkg!.id, intents }
  }

  /**
   * A S$120 place in a Workshop the studio then cancels, bought by `who` through one Purchase
   * and one payment. Cancelling refunds nobody (#272), so the place is left waiting.
   */
  const cancelledWorkshopPlace = async (studio: Studio, who: Member, workshopName: string) => {
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: studio.id, name: `${studio.slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: studio.id, locationId: location!.id, name: 'Main room', capacity: 20 })
      .returning({ id: schema.rooms.id })
    const lead = await staffAt(studio, `lead-${++studios}`, 'instructor')
    const workshop = await withTenant(studio.id, () =>
      workshopsSvc.publish.createWorkshop(studio.id, {
        name: workshopName,
        locationId: location!.id,
        mainInstructorId: lead.id,
        mainInstructorPaySgd: 100,
        createdByStaffId: lead.id,
      }),
    )
    const startsAt = new Date(Date.now() + 40 * DAY)
    const day = await withTenant(studio.id, () =>
      workshopsSvc.days.createDay(studio.id, workshop.id, {
        ord: 1,
        roomId: room!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        basePriceSgd: '120.00',
        capacityOnline: 10,
      }),
    )
    const tier = await withTenant(studio.id, () =>
      workshopsSvc.tiers.createTier(studio.id, workshop.id, {
        name: 'Full Pass',
        regularPriceSgd: '120.00',
        ord: 1,
        dayIds: [day.id],
      }),
    )
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: studio.id, clientId: who.clientId, kind: 'workshop', totalSgd: '120.00', amountPaidSgd: '120.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    const intent = `pi_rfa_${randomUUID().slice(0, 12)}`
    await harness.db.insert(schema.stripePayments).values({
      tenantId: studio.id,
      paymentIntentId: intent,
      purchaseId: purchase!.id,
      amountSgd: '120.00',
      kind: 'workshop',
      clientId: who.clientId,
      status: 'pending',
      providerAccountId: ownAccountId(studio),
    })
    const booked = await withTenant(studio.id, () =>
      workshopsSvc.book.bookWorkshopPaid(studio.id, {
        clientId: who.clientId,
        workshopId: workshop.id,
        workshopTierId: tier.id,
        paymentIntentId: intent,
        purchaseId: purchase!.id,
        amountSgd: '120.00',
      }),
    )
    return { workshopId: workshop.id, lead, purchaseId: purchase!.id, bookingId: booked.bookingId, intent }
  }

  const cancelWorkshop = (studio: Studio, p: { workshopId: string; lead: Staff }) =>
    withTenant(studio.id, () => workshopsSvc.cancel.cancelWorkshop(studio.id, p.workshopId, p.lead.id, 'admin'))

  /** The admin's Refund button on a workshop place. */
  const refundPlace = (admin: Staff, who: Member, p: { bookingId: string }) =>
    send(`/portal/admin/clients/${who.clientId}/workshop-bookings/${p.bookingId}/refund`, admin.headers, 'POST', { reason: 'Asked to' })

  /** The admin's Refund button on a package, as the portal posts it. */
  const refundPackage = (admin: Staff, who: Member, p: { clientPackageId: string }) =>
    send(`/portal/admin/clients/${who.clientId}/packages/${p.clientPackageId}/refund`, admin.headers, 'POST', { reason: 'Asked to' })

  /** The provider's `charge.refunded` for one payment. */
  const chargeRefunded = async (studio: Studio, intent: string, cents: number) => {
    const res = await harness.app.request(stripeWebhookPath(studio.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
      body: JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${randomUUID().slice(0, 12)}`,
            payment_intent: intent,
            amount: cents,
            amount_captured: cents,
            amount_refunded: cents,
            metadata: {},
          },
        },
      }),
    })
    assert.equal(res.status, 200)
  }

  /** The provider refuses the nth refund call from now on and accepts the rest. */
  const failRefundNumber = (n: number) => {
    let calls = 0
    fake.reply('refunds.create', () => {
      calls += 1
      if (calls === n) throw new Error('card_declined')
      return { id: 're_fake', status: 'succeeded' }
    })
  }
  const acceptRefunds = () => fake.reply('refunds.create', { id: 're_fake', status: 'succeeded' })

  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const itemsOf = async (who: Staff, kind: string) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === kind)
  const dismiss = (who: Staff, kind: string, subjectId: string) =>
    send('/portal/attention/dismissals', who.headers, 'POST', { kind, subject_id: subjectId })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    withTenant = (await import('../db')).withTenant
    workshopsSvc = {
      publish: await import('../services/workshops/publish'),
      days: await import('../services/workshops/days'),
      tiers: await import('../services/workshops/tiers'),
      book: await import('../services/workshops/book'),
      cancel: await import('../services/workshops/cancel'),
    }
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    acceptRefunds()
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
  })

  after(async () => {
    fake?.restore()
    harness?.clock.reset()
    await harness?.close()
  })

  test('ATN-90 a refund that stopped part-way is a Payments item saying how many of the payments went back, linking to the member with that purchase', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Ida Halfway')
    const split = await paidPackage(studio, who, ['100.00', '50.00'])
    const whole = await paidPackage(studio, who, ['80.00'])

    failRefundNumber(2)
    assert.equal((await json(await refundPackage(admin, who, split), 200)).complete, false)
    acceptRefunds()
    await json(await refundPackage(admin, who, whole), 200)

    const items = await itemsOf(admin, 'refund_incomplete')
    assert.deepEqual(
      items.map(i => i.id),
      [`refund_incomplete:${split.purchaseId}`],
      'only the refund that stopped; one asked for in full is on its way',
    )
    const [item] = items
    assert.equal(item!.title, "The refund of Ida Halfway's Ten pass stopped part-way: 1 of 2 payments returned")
    assert.equal(item!.detail, 'Press Refund again to return the rest')
    assert.equal(item!.href, `/admin/customers/${who.clientId}?purchase=${split.purchaseId}`)
    assert.equal(item!.dismissable, false)
    assert.equal(item!.location, null)

    const group = (await panel(admin)).needs_action.groups.find((g: any) => g.items.some((i: any) => i.kind === 'refund_incomplete'))
    assert.equal(group.key, 'payments_refunds')
  })

  test('ATN-91 an incomplete refund clears when pressing Refund again returns the rest and the last payment is confirmed back', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Una Retry')
    const split = await paidPackage(studio, who, ['100.00', '50.00'])

    failRefundNumber(2)
    await json(await refundPackage(admin, who, split), 200)
    const before = (await summary(admin)).needs_action
    assert.equal((await itemsOf(admin, 'refund_incomplete')).length, 1)

    // The first payment's confirmation lands; the refund is still not finished.
    await chargeRefunded(studio, split.intents[0]!, 10000)
    assert.equal((await itemsOf(admin, 'refund_incomplete')).length, 1, 'one payment confirmed back is not all of them')

    acceptRefunds()
    assert.equal((await json(await refundPackage(admin, who, split), 200)).complete, true)
    assert.deepEqual(await itemsOf(admin, 'refund_incomplete'), [], 'the rest is asked for and on its way')
    assert.equal((await summary(admin)).needs_action, before - 1, 'the bubble follows')

    await chargeRefunded(studio, split.intents[1]!, 5000)
    assert.deepEqual(await itemsOf(admin, 'refund_incomplete'), [])
    assert.deepEqual(await itemsOf(admin, 'refund_unconfirmed'), [])
  })

  test('ATN-92 a refund Stripe has not confirmed is an item only once a day has passed: 23 h 59 min is still on its way, 24 h 1 min is not', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Uma Waiting')
    const pkg = await paidPackage(studio, who, ['150.00'])
    const asked = new Date()
    await json(await refundPackage(admin, who, pkg), 200)

    try {
      assert.deepEqual(await itemsOf(admin, 'refund_unconfirmed'), [], 'just asked for')
      harness.clock.set(new Date(asked.getTime() + DAY - 2 * 60 * 1000))
      assert.deepEqual(await itemsOf(admin, 'refund_unconfirmed'), [], '23 h 58 min on')

      harness.clock.set(new Date(asked.getTime() + DAY + 2 * 60 * 1000))
      const items = await itemsOf(admin, 'refund_unconfirmed')
      assert.deepEqual(items.map(i => i.id), [`refund_unconfirmed:${pkg.purchaseId}`])
      assert.equal(items[0]!.title, "Stripe hasn't confirmed Uma Waiting's S$150.00 refund after a day")
      assert.equal(items[0]!.detail, "Check it in Stripe; refund again if it didn't go through")
      assert.equal(items[0]!.href, `/admin/customers/${who.clientId}?purchase=${pkg.purchaseId}`)
      assert.equal(items[0]!.dismissable, false)
      assert.deepEqual(await itemsOf(admin, 'refund_incomplete'), [], 'a refund asked for in full is not an incomplete one')
    } finally {
      harness.clock.reset()
    }
  })

  test('ATN-93 an unconfirmed refund clears when it is re-issued, and when the payment is confirmed refunded', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Vic Reissue')
    const reissued = await paidPackage(studio, who, ['90.00'])
    const confirmed = await paidPackage(studio, who, ['60.00'])
    const asked = new Date()
    await json(await refundPackage(admin, who, reissued), 200)
    await json(await refundPackage(admin, who, confirmed), 200)

    try {
      harness.clock.set(new Date(asked.getTime() + DAY + 60 * 1000))
      assert.equal((await itemsOf(admin, 'refund_unconfirmed')).length, 2)

      // Re-issued: the Refund is pressed again, which the day-old ask no longer blocks.
      fake.calls.length = 0
      await json(await refundPackage(admin, who, reissued), 200)
      assert.equal(fake.callsTo('refunds.create').length, 1, 'Stripe is asked again')
      assert.deepEqual(
        (await itemsOf(admin, 'refund_unconfirmed')).map(i => i.id),
        [`refund_unconfirmed:${confirmed.purchaseId}`],
      )

      // Confirmed late: the payment is refunded.
      await chargeRefunded(studio, confirmed.intents[0]!, 6000)
      assert.deepEqual(await itemsOf(admin, 'refund_unconfirmed'), [])
    } finally {
      harness.clock.reset()
    }
  })

  test('ATN-94 a paid place in a cancelled workshop that nobody refunded is one dismissable item per booking, saying who paid what for which workshop', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const ann = await memberAt(studio, 'Ann Paid')
    const bea = await memberAt(studio, 'Bea Paid')
    const annsPlace = await cancelledWorkshopPlace(studio, ann, 'Backbend Intensive')
    const beasPlace = await cancelledWorkshopPlace(studio, bea, 'Arm Balance Day')
    assert.deepEqual(await itemsOf(admin, 'workshop_cancelled_unrefunded'), [], 'a workshop still running is nobody’s refund')

    await cancelWorkshop(studio, annsPlace)
    await cancelWorkshop(studio, beasPlace)

    const items = await itemsOf(admin, 'workshop_cancelled_unrefunded')
    assert.deepEqual(
      items.map(i => i.id).sort(),
      [annsPlace.bookingId, beasPlace.bookingId].map(id => `workshop_cancelled_unrefunded:${id}`).sort(),
    )
    const mine = items.find(i => i.id === `workshop_cancelled_unrefunded:${annsPlace.bookingId}`)!
    assert.equal(mine.title, "Ann Paid paid S$120.00 for Backbend Intensive, which was cancelled, and hasn't been refunded")
    assert.equal(mine.detail, 'Refund it from their page, or dismiss to keep the payment')
    assert.equal(mine.href, `/admin/customers/${ann.clientId}?purchase=${annsPlace.purchaseId}`)
    assert.equal(mine.dismissable, true)
    assert.equal(
      (await panel(admin)).needs_action.groups.find((g: any) => g.items.some((i: any) => i.kind === 'workshop_cancelled_unrefunded')).key,
      'payments_refunds',
    )
  })

  test('ATN-95 the cancelled-workshop item clears when its booking is refunded, and when it is dismissed, which is audited under the admin', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const cat = await memberAt(studio, 'Cat Refunded')
    const dee = await memberAt(studio, 'Dee Keeps')
    const cats = await cancelledWorkshopPlace(studio, cat, 'Inversions Day')
    const dees = await cancelledWorkshopPlace(studio, dee, 'Inversions Day Two')
    await cancelWorkshop(studio, cats)
    await cancelWorkshop(studio, dees)
    const KIND = 'workshop_cancelled_unrefunded'
    assert.equal((await itemsOf(admin, KIND)).length, 2)

    // Refunded: the Refund asked for goes out, the item goes with it, and stays gone once confirmed.
    fake.calls.length = 0
    await json(await refundPlace(admin, cat, cats), 200)
    assert.deepEqual((await itemsOf(admin, KIND)).map(i => i.id), [`${KIND}:${dees.bookingId}`])
    await chargeRefunded(studio, cats.intent, 12000)
    assert.deepEqual((await itemsOf(admin, KIND)).map(i => i.id), [`${KIND}:${dees.bookingId}`])

    // Dismissed: hidden for the studio, and the payment is untouched.
    assert.equal((await dismiss(admin, KIND, dees.bookingId)).status, 204)
    assert.deepEqual(await itemsOf(admin, KIND), [])
    const rows = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, studio.id))
    const filed = rows.filter(r => r.action === 'attention.dismissed')
    assert.equal(filed.length, 1)
    assert.equal(filed[0]!.actorStaffId, admin.id)
    assert.deepEqual(filed[0]!.payload, { kind: KIND, subject_id: dees.bookingId })
    assert.deepEqual(
      fake.callsTo('refunds.create').map(call => (call.args[0] as { payment_intent: string }).payment_intent),
      [cats.intent],
      'dismissing refunds nobody: only the refunded booking’s payment was returned',
    )

    // Not an open item: nothing to dismiss now.
    assert.equal((await dismiss(admin, KIND, dees.bookingId)).status, 404)
    assert.equal((await dismiss(admin, KIND, cats.bookingId)).status, 404)
  })

  test('ATN-96 all three are admin only: an instructor sees none of them and none count toward their bubble, and cannot dismiss the workshop one', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const teacher = await staffAt(studio, 'teach', 'instructor')
    const who = await memberAt(studio, 'Wes Everything')
    const split = await paidPackage(studio, who, ['100.00', '50.00'])
    const lone = await paidPackage(studio, who, ['40.00'])
    const place = await cancelledWorkshopPlace(studio, who, 'Handstand Day')
    const asked = new Date()
    await json(await refundPackage(admin, who, lone), 200)

    try {
      // A day on, `lone` is unconfirmed; the others happen now.
      harness.clock.set(new Date(asked.getTime() + DAY + 60 * 1000))
      failRefundNumber(2)
      await json(await refundPackage(admin, who, split), 200)
      acceptRefunds()
      await cancelWorkshop(studio, place)
      const kinds = ['refund_incomplete', 'refund_unconfirmed', 'workshop_cancelled_unrefunded']
      for (const kind of kinds) {
        assert.equal((await itemsOf(admin, kind)).length, 1, `${kind} for the admin`)
        assert.deepEqual(await itemsOf(teacher, kind), [], `${kind} for the instructor`)
      }
      const theirs = await summary(teacher)
      assert.equal(theirs.needs_action, 0)
      assert.equal((await dismiss(teacher, 'workshop_cancelled_unrefunded', place.bookingId)).status, 403)
    } finally {
      harness.clock.reset()
    }
  })

  test('ATN-97 the member page tells each purchase apart: packages, workshop places and unfinished purchases carry the purchase id the bell links with', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'boss', 'admin')
    const who = await memberAt(studio, 'Xia Linked')
    const pkg = await paidPackage(studio, who, ['100.00', '50.00'])
    const place = await cancelledWorkshopPlace(studio, who, 'Splits Day')
    await cancelWorkshop(studio, place)

    const profile = await json(await send(`/portal/admin/clients/${who.clientId}`, admin.headers), 200)
    assert.equal(profile.packages.find((p: any) => p.id === pkg.clientPackageId).purchase_id, pkg.purchaseId)
    assert.equal(profile.workshop_purchases.find((w: any) => w.booking_id === place.bookingId).purchase_id, place.purchaseId)
  })

  test('ATN-98 refund items belong to their studio: another studio’s refunds never appear in or count toward this one', async () => {
    const mine = await freshStudio()
    const theirs = await freshStudio()
    const myAdmin = await staffAt(mine, 'boss', 'admin')
    const theirAdmin = await staffAt(theirs, 'boss', 'admin')
    const them = await memberAt(theirs, 'Yan Elsewhere')
    const split = await paidPackage(theirs, them, ['100.00', '50.00'])
    const place = await cancelledWorkshopPlace(theirs, them, 'Elsewhere Day')
    await cancelWorkshop(theirs, place)
    failRefundNumber(2)
    await json(await refundPackage(theirAdmin, them, split), 200)
    acceptRefunds()

    const baseline = (await summary(myAdmin)).needs_action
    for (const kind of ['refund_incomplete', 'refund_unconfirmed', 'workshop_cancelled_unrefunded']) {
      assert.deepEqual(await itemsOf(myAdmin, kind), [], kind)
    }
    assert.equal(baseline, 0)
    assert.equal((await dismiss(myAdmin, 'workshop_cancelled_unrefunded', place.bookingId)).status, 404)
    assert.equal((await itemsOf(theirAdmin, 'refund_incomplete')).length, 1)
    assert.equal((await itemsOf(theirAdmin, 'workshop_cancelled_unrefunded')).length, 1)
  })
})
