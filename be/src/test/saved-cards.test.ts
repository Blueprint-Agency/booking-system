import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, like, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.saved-cards.test`

/**
 * A member's saved cards (#185): listing them, and removing one, at the
 * studio's own payment account and nowhere else.
 *
 * Written from PAY-48 to PAY-51 of the Scenario Inventory
 * (`docs/md/test-scenarios.md`) and be-client §3 `me.ts`. A card exists only at
 * the payment provider, so the fake provider here keeps a small wallet per
 * account — which card is on which Customer — and answers `paymentMethods.*`
 * from it, the way the provider would: a card is only found on the account it
 * was saved on, and a detached card leaves its Customer.
 */
describe('saved cards over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let stripeFake!: typeof import('./stripe-fake')
  let fake!: StripeFake

  type Tenant = { id: string; slug: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Card = { id: string; customer: string | null; brand: string; last4: string; exp_month: number; exp_year: number }

  let one!: Tenant
  let two!: Tenant

  /* ── the provider's side: cards by account ─────────────────────────── */

  const wallet = new Map<string, Map<string, Card>>()
  const cardsOn = (accountId: string) => {
    const cards = wallet.get(accountId) ?? new Map<string, Card>()
    wallet.set(accountId, cards)
    return cards
  }

  /** A payment method as the provider returns it — more than a member may be told. */
  const asMethod = (card: Card) => ({
    id: card.id,
    object: 'payment_method',
    type: 'card',
    customer: card.customer,
    billing_details: { email: 'holder@example.test', name: 'Card Holder' },
    card: {
      brand: card.brand,
      last4: card.last4,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      fingerprint: 'fp_must_not_leak',
      funding: 'credit',
      country: 'SG',
    },
  })

  const noSuchMethod = (id: unknown) =>
    Object.assign(new Error(`No such PaymentMethod: '${String(id)}'`), {
      code: 'resource_missing',
      type: 'StripeInvalidRequestError',
    })

  /**
   * The provider's answers, read off the wallet of the account the call was
   * made on (the call is recorded before it is answered).
   */
  function answerFromWallet(f: StripeFake) {
    const account = () => {
      const call = f.calls.at(-1)
      assert.ok(call?.account, 'a card call must be bound to an account')
      return call.account
    }
    f.reply('paymentMethods.list', (params: unknown) => {
      const { customer } = params as { customer: string }
      const data = [...cardsOn(account()).values()].filter(card => card.customer === customer).map(asMethod)
      return { object: 'list', has_more: false, data }
    })
    f.reply('paymentMethods.retrieve', (id: unknown) => {
      const card = cardsOn(account()).get(String(id))
      if (!card) throw noSuchMethod(id)
      return asMethod(card)
    })
    f.reply('paymentMethods.detach', (id: unknown) => {
      const card = cardsOn(account()).get(String(id))
      if (!card) throw noSuchMethod(id)
      card.customer = null
      return asMethod(card)
    })
  }

  /** The fake every test but PAY-51 uses: both studios on their own accounts. */
  function installProvider(): StripeFake {
    const f = stripeFake.installStripeFake()
    f.ownAccount(one)
    f.ownAccount(two)
    answerFromWallet(f)
    return f
  }

  /* ── people ─────────────────────────────────────────────────────────── */

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  let members = 0

  async function member(at: Tenant): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  async function admin(at: Tenant): Promise<{ headers: Record<string, string> }> {
    const email = emailFor(`admin-${members++}-${at.slug}`)
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name: 'Card Admin', role: 'admin', status: 'active', authUserId: user!.id })
    return { headers }
  }

  /**
   * The member made a Provider Customer on the studio's own account, with
   * these cards saved against them there — what checkouts with "save my card"
   * ticked would have left behind.
   */
  async function savesCards(at: Tenant, who: Member, cards: Omit<Card, 'id' | 'customer'>[]): Promise<{ customerId: string; cardIds: string[] }> {
    const customerId = `cus_${randomUUID().replace(/-/g, '').slice(0, 14)}`
    const accountId = stripeFake.ownAccountId(at)
    await harness.db.insert(schema.paymentCustomers).values({ tenantId: at.id, clientId: who.clientId, providerAccountId: accountId, customerId })
    const cardIds = cards.map(card => {
      const id = `pm_${randomUUID().replace(/-/g, '').slice(0, 20)}`
      cardsOn(accountId).set(id, { ...card, id, customer: customerId })
      return id
    })
    return { customerId, cardIds }
  }

  const VISA = { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 }
  const MASTERCARD = { brand: 'mastercard', last4: '4444', exp_month: 3, exp_year: 2029 }
  const AMEX = { brand: 'amex', last4: '0005', exp_month: 7, exp_year: 2030 }

  /* ── requests ───────────────────────────────────────────────────────── */

  /** `who`'s token on `at`'s hostname of the member app. */
  const sentTo = (who: { headers: Record<string, string> }, at: Tenant) => ({
    Authorization: who.headers.Authorization!,
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin('client', at),
    'X-Forwarded-For': harnessAddress(),
  })
  const anonymousAt = (at: Tenant) => ({
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin('client', at),
    'X-Forwarded-For': harnessAddress(),
  })

  const listCards = (headers: Record<string, string>) => harness.app.request('/api/v1/me/cards', { headers })
  const deleteCard = (headers: Record<string, string>, id: string) =>
    harness.app.request(`/api/v1/me/cards/${id}`, { method: 'DELETE', headers })

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  const customersOf = (who: Member) =>
    harness.db
      .select({ customerId: schema.paymentCustomers.customerId, providerAccountId: schema.paymentCustomers.providerAccountId })
      .from(schema.paymentCustomers)
      .where(eq(schema.paymentCustomers.clientId, who.clientId))
  /** Audit rows naming the card routes — a member's own removal writes none. */
  const cardAudits = () =>
    harness.db.select({ id: schema.auditLog.id }).from(schema.auditLog).where(like(schema.auditLog.action, '%/me/cards%'))
  const detached = () => fake.callsTo('paymentMethods.detach').map(call => call.args[0])
  const listedIds = async (who: Member) => {
    const body = await expectStatus(await listCards(who.headers), 200)
    return (body.cards as { id: string }[]).map(card => card.id).sort()
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    stripeFake = await import('./stripe-fake')
    one = harness.tenants.one
    two = harness.tenants.two
    fake = installProvider()
  })

  after(async () => {
    if (!harness) return
    try {
      fake?.restore()
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── PAY-48: listing ────────────────────────────────────────────────── */

  test('PAY-48 a member lists only their own saved cards, each as brand, last four and expiry, read from the studio’s own account', async () => {
    const mia = await member(one)
    const neighbour = await member(one)
    const mine = await savesCards(one, mia, [VISA, MASTERCARD])
    await savesCards(one, neighbour, [AMEX])
    fake.calls.length = 0

    const body = await expectStatus(await listCards(mia.headers), 200)

    const expected = [
      { id: mine.cardIds[0], ...VISA },
      { id: mine.cardIds[1], ...MASTERCARD },
    ].sort((a, b) => a.id!.localeCompare(b.id!))
    const cards = (body.cards as { id: string }[]).slice().sort((a, b) => a.id.localeCompare(b.id))
    assert.deepEqual(cards, expected, 'their two cards, and no field the provider holds beyond these')
    assert.ok(!JSON.stringify(body).includes('fp_must_not_leak'), 'no fingerprint reaches the member')
    assert.ok(!JSON.stringify(body).includes('holder@example.test'), 'no billing details reach the member')

    const lists = fake.callsTo('paymentMethods.list')
    assert.equal(lists.length, 1)
    assert.equal(lists[0]!.account, stripeFake.ownAccountId(one), 'asked on the studio’s own account')
    assert.equal((lists[0]!.args[0] as { customer: string }).customer, mine.customerId, 'for this member’s Customer only')
    assert.deepEqual(await customersOf(mia), [{ customerId: mine.customerId, providerAccountId: stripeFake.ownAccountId(one) }], 'a read leaves the Customer as it was')
  })

  test('PAY-48 a member who has saved no card gets an empty list, and the provider is not asked', async () => {
    const newcomer = await member(one)
    fake.calls.length = 0

    const body = await expectStatus(await listCards(newcomer.headers), 200)

    assert.deepEqual(body, { cards: [] })
    assert.deepEqual(fake.calls, [], 'no Customer, so nothing to ask the provider')
    assert.deepEqual(await customersOf(newcomer), [], 'listing makes no one a Customer')
  })

  test('PAY-48 listing cards is refused to another studio’s member, a staff session and an anonymous caller, and the provider is not asked', async () => {
    const mia = await member(one)
    await savesCards(one, mia, [VISA])
    const elsewhere = await member(two)
    await savesCards(two, elsewhere, [AMEX])
    const staff = await admin(one)
    fake.calls.length = 0

    await expectStatus(await listCards(sentTo(elsewhere, one)), 401, 'invalid_token')
    await expectStatus(await listCards(sentTo(staff, one)), 401, 'invalid_token')
    await expectStatus(await listCards(anonymousAt(one)), 401, 'missing_bearer_token')

    assert.deepEqual(fake.calls, [], 'a refused caller reaches no provider account')
  })

  /* ── PAY-49: removing one ───────────────────────────────────────────── */

  test('PAY-49 a member deletes one of their cards: it is detached at the studio’s account and gone from their list, the other stays', async () => {
    const mia = await member(one)
    const mine = await savesCards(one, mia, [VISA, MASTERCARD])
    const [gone, kept] = mine.cardIds as [string, string]
    fake.calls.length = 0
    const auditsBefore = (await cardAudits()).length

    const body = await expectStatus(await deleteCard(mia.headers, gone), 200)

    assert.deepEqual(body, { removed: true })
    assert.deepEqual(detached(), [gone], 'exactly that card is detached')
    assert.equal(fake.callsTo('paymentMethods.detach')[0]!.account, stripeFake.ownAccountId(one), 'on the studio’s own account')
    assert.deepEqual(await listedIds(mia), [kept], 'gone from their list; the other card stays')
    assert.deepEqual(
      await customersOf(mia),
      [{ customerId: mine.customerId, providerAccountId: stripeFake.ownAccountId(one) }],
      'they remain the studio’s Provider Customer',
    )
    assert.equal((await cardAudits()).length, auditsBefore, 'a member’s own removal writes no staff audit row')
  })

  test('PAY-49 deleting a card is refused to another studio’s member, a staff session and an anonymous caller, and nothing is detached', async () => {
    const mia = await member(one)
    const mine = await savesCards(one, mia, [VISA])
    const elsewhere = await member(two)
    await savesCards(two, elsewhere, [AMEX])
    const staff = await admin(one)
    fake.calls.length = 0

    await expectStatus(await deleteCard(sentTo(elsewhere, one), mine.cardIds[0]!), 401, 'invalid_token')
    await expectStatus(await deleteCard(sentTo(staff, one), mine.cardIds[0]!), 401, 'invalid_token')
    await expectStatus(await deleteCard(anonymousAt(one), mine.cardIds[0]!), 401, 'missing_bearer_token')

    assert.deepEqual(fake.calls, [], 'a refused caller reaches no provider account')
    assert.deepEqual(await listedIds(mia), mine.cardIds, 'the card is still the member’s')
  })

  /* ── PAY-50: not theirs ─────────────────────────────────────────────── */

  test('PAY-50 deleting another member’s card at the same studio, a card at another studio, or an id never issued is refused alike, and nothing is detached', async () => {
    const mia = await member(one)
    await savesCards(one, mia, [VISA])
    const neighbour = await member(one)
    const theirs = await savesCards(one, neighbour, [MASTERCARD])
    const elsewhere = await member(two)
    const acrossStudios = await savesCards(two, elsewhere, [AMEX])
    fake.calls.length = 0

    await expectStatus(await deleteCard(mia.headers, theirs.cardIds[0]!), 404, 'card_not_found')
    await expectStatus(await deleteCard(mia.headers, acrossStudios.cardIds[0]!), 404, 'card_not_found')
    await expectStatus(await deleteCard(mia.headers, 'pm_never_issued_anywhere'), 404, 'card_not_found')

    assert.deepEqual(detached(), [], 'nothing is detached')
    assert.ok(
      fake.calls.every(call => call.account === stripeFake.ownAccountId(one)),
      'only the member’s own studio’s account is ever asked',
    )
    assert.deepEqual(await listedIds(neighbour), theirs.cardIds, 'the neighbour still has their card')
    const elsewhereList = await expectStatus(await listCards(elsewhere.headers), 200)
    assert.deepEqual(
      (elsewhereList.cards as { id: string }[]).map(card => card.id),
      acrossStudios.cardIds,
      'the other studio’s member still has their card',
    )
  })

  /* ── PAY-51: a studio taking no online payments ─────────────────────── */

  test('PAY-51 at a studio with no payment credentials of its own, cards list empty and a delete is refused payments_not_configured, with no provider asked', async () => {
    const mia = await member(one)
    const mine = await savesCards(one, mia, [VISA])
    // The same studio, now with no account of its own: the credentials it
    // supplied are gone, while the Customer row and the card at the provider
    // remain from when it had them.
    fake.restore()
    const bare = stripeFake.installStripeFake()
    answerFromWallet(bare)
    try {
      const list = await expectStatus(await listCards(mia.headers), 200)
      assert.deepEqual(list, { cards: [] })

      await expectStatus(await deleteCard(mia.headers, mine.cardIds[0]!), 409, 'payments_not_configured')

      assert.deepEqual(bare.calls, [], 'no payment provider is asked for anything')
      assert.equal(cardsOn(stripeFake.ownAccountId(one)).get(mine.cardIds[0]!)!.customer, mine.customerId, 'the card stays attached')
      assert.deepEqual(await customersOf(mia), [{ customerId: mine.customerId, providerAccountId: stripeFake.ownAccountId(one) }])
    } finally {
      bare.restore()
      fake = installProvider()
    }
  })
})
