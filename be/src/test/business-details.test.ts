import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { receiptFixtures } from './receipt-fixtures'
import { withEnv } from './with-env'
import { billed } from './billing-details-fixture'

const run = Date.now().toString(36)
const DOMAIN = `${run}.business-details.test`
const OPERATOR = `operator@${DOMAIN}`

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/**
 * A studio's Business name: the one name it trades under, a row it owns
 * in `tenant_settings`. The super portal gives it one when it creates the
 * studio (the Domain name when the operator leaves it blank), and the studio's
 * admin changes it on the Business details page, beside the registration
 * number, address, footer note and Receipt prefix it replaced the Legal name
 * among.
 *
 * Every studio here is created by the super portal over HTTP and read back as
 * its admin reads it.
 *
 * Written from the TEN rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('a studio’s Business name', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let receipts!: ReturnType<typeof receiptFixtures>
  let operator!: Record<string, string>

  type Studio = { id: string; slug: string; domainName: string; admin: Record<string, string> }

  const json = { 'Content-Type': 'application/json' }
  const DETAILS_PATH = '/api/v1/portal/admin/settings/business-details'

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  let studios = 0
  /** A studio the super portal creates, with a first admin who has taken up their invitation. */
  async function newStudio(extra: Record<string, unknown> = {}): Promise<Studio> {
    const slug = `bd-${run}-${studios++}`
    const domainName = `Domain ${slug}`
    const adminEmail = `admin-${slug}@${DOMAIN}`
    const created = await expectStatus(
      await harness.app.request('/api/v1/platform/tenants', {
        method: 'POST',
        headers: { ...operator, ...json },
        body: JSON.stringify({ slug, name: domainName, admin_email: adminEmail, ...extra }),
      }),
      201,
    )
    const tenantId: string = created.tenant.id
    const [invitation] = await harness.db
      .select({ token: schema.staffInvitations.token })
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.tenantId, tenantId))
    const { withTenant } = await import('../db')
    const { acceptInvitation } = await import('../services/auth/invitations')
    await withTenant(tenantId, () => acceptInvitation({ tenantId, token: invitation!.token, password: 'a-first-password' }))
    return { id: tenantId, slug, domainName, admin: await harness.signInAs('staff', adminEmail, { slug }) }
  }

  let members = 0
  /** A member of the studio, signed in to it. */
  async function member(at: Studio): Promise<{ clientId: string; email: string; headers: Record<string, string> }> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  const readDetails = (at: Studio) => harness.app.request(DETAILS_PATH, { headers: at.admin })
  const saveDetails = (at: Studio, body: unknown) =>
    harness.app.request(DETAILS_PATH, { method: 'PUT', headers: { ...at.admin, ...json }, body: JSON.stringify(body) })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    receipts = receiptFixtures(harness)
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await receipts?.cleanup()
    const ours = `%@${DOMAIN}`
    // What PAY-57's checkouts left: the provider customers made for its buyers,
    // and their Open Purchases, which no payment settled.
    const buyers = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${buyers})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${buyers})`)
    await harness.db.execute(sql`DELETE FROM client_billing_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('TEN-36 an admin reads the studio’s Business details, saves a new Business name with the rest, and reads back what was saved; a blank or overlong Business name is refused in a sentence', async () => {
    const studio = await newStudio()

    assert.deepEqual(await expectStatus(await readDetails(studio), 200), {
      business_details: {
        business_name: studio.domainName,
        display_name: studio.domainName,
        prefix: 'R',
        registration_number: null,
        address: null,
        footer: null,
      },
      next_number: 'R-000001',
      next_sequence: 1,
    })

    const details = {
      business_name: `Northwind ${run} Pte. Ltd.`,
      prefix: 'NW',
      registration_number: `2026${run}`,
      address: '1 Example Street\nSingapore 000001',
      footer: 'Thank you for practising with us.',
    }
    const saved = await expectStatus(await saveDetails(studio, { ...details, business_name: `  ${details.business_name}  ` }), 200)
    // Sent without a Display name, which leaves the one the studio has.
    assert.deepEqual(
      saved,
      { business_details: { ...details, display_name: studio.domainName }, next_number: 'NW-000001', next_sequence: 1 },
      'saved trimmed',
    )
    assert.deepEqual(await expectStatus(await readDetails(studio), 200), saved, 'what was saved is what is read')

    for (const [business_name, sentence] of [
      [undefined, 'A business name is required.'],
      ['', 'A business name is required.'],
      ['   ', 'A business name is required.'],
      ['x'.repeat(201), 'The business name is at most 200 characters.'],
    ] as const) {
      const refused = await expectStatus(await saveDetails(studio, { ...details, business_name }), 400)
      assert.equal(refused.error, 'invalid_request')
      assert.equal(refused.message, sentence)
    }
    assert.deepEqual(await expectStatus(await readDetails(studio), 200), saved, 'nothing refused changed what the studio has')
  })

  test('TEN-37 the super portal creates a studio with a Business name, and one without, which trades under its Domain name; an overlong one is refused and no studio made', async () => {
    const named = await newStudio({
      business_details: { business_name: `Acme ${run} Wellness`, prefix: 'AC', registration_number: `REG ${run}` },
    })
    assert.deepEqual((await expectStatus(await readDetails(named), 200)).business_details, {
      business_name: `Acme ${run} Wellness`,
      display_name: named.domainName,
      prefix: 'AC',
      registration_number: `REG ${run}`,
      address: null,
      footer: null,
    })

    const blank = await newStudio({ business_details: { business_name: '  ' } })
    assert.equal((await expectStatus(await readDetails(blank), 200)).business_details.business_name, blank.domainName)
    const omitted = await newStudio()
    assert.equal((await expectStatus(await readDetails(omitted), 200)).business_details.business_name, omitted.domainName)

    const slug = `bd-${run}-refused`
    const refused = await expectStatus(
      await harness.app.request('/api/v1/platform/tenants', {
        method: 'POST',
        headers: { ...operator, ...json },
        body: JSON.stringify({ slug, name: 'Refused studio', business_details: { business_name: 'x'.repeat(201) } }),
      }),
      400,
    )
    assert.equal(refused.error, 'invalid_request')
    assert.equal(refused.message, 'The business name is at most 200 characters.')
    assert.deepEqual(await harness.db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)), [])
  })

  test('TEN-41 the super portal reads a studio’s Business details and saves new ones, which its admin then reads and its next email is signed with by Display name; a blank Business name is refused in a sentence, the route is the operator’s alone, and an archived studio’s are not reached', async () => {
    const studio = await newStudio()
    const path = `/api/v1/platform/tenants/${studio.id}/business-details`
    const put = (headers: Record<string, string>, body: unknown) =>
      harness.app.request(path, { method: 'PUT', headers: { ...headers, ...json }, body: JSON.stringify(body) })

    const read = await expectStatus(await harness.app.request(path, { headers: operator }), 200)
    assert.equal(read.business_details.business_name, studio.domainName)
    assert.equal(read.next_number, 'R-000001')

    const businessName = `Northwind ${run} Holdings`
    const displayName = `Northwind ${run} Yoga`
    const saved = await expectStatus(
      await put(operator, {
        business_name: `  ${businessName}  `,
        display_name: ` ${displayName} `,
        prefix: 'NW',
        registration_number: `UEN ${run}`,
        address: '1 Harbour Road\nSingapore 000001',
        footer: 'Thank you.',
      }),
      200,
    )
    const expected = {
      business_name: businessName,
      display_name: displayName,
      prefix: 'NW',
      registration_number: `UEN ${run}`,
      address: '1 Harbour Road\nSingapore 000001',
      footer: 'Thank you.',
    }
    assert.deepEqual(saved.business_details, expected)
    assert.equal(saved.next_number, 'NW-000001')
    assert.deepEqual((await expectStatus(await readDetails(studio), 200)).business_details, expected)
    const mail = await signInCodeMail(studio, `visitor-operator@${DOMAIN}`)
    assert.match(mail.from, new RegExp(`^"${displayName}" <`), 'the next email is signed with the new Display name')

    const refused = await expectStatus(await put(operator, { business_name: '   ' }), 400)
    assert.equal(refused.error, 'invalid_request')
    assert.equal(refused.message, 'A business name is required.')
    assert.deepEqual((await expectStatus(await readDetails(studio), 200)).business_details, expected)

    await expectStatus(await harness.app.request(path, { headers: studio.admin }), 404)
    await expectStatus(await put(studio.admin, { business_name: 'Not the operator' }), 404)
    await expectStatus(
      await harness.app.request('/api/v1/platform/tenants/00000000-0000-4000-8000-000000000000/business-details', {
        headers: operator,
      }),
      404,
    )
    await expectStatus(await put(operator, null), 400)

    // An archived studio is frozen: its details are neither read nor changed.
    const archived = await newStudio()
    await expectStatus(
      await harness.app.request(`/api/v1/platform/tenants/${archived.id}/status`, {
        method: 'PATCH',
        headers: { ...operator, ...json },
        body: JSON.stringify({ status: 'archived' }),
      }),
      200,
    )
    const archivedPath = `/api/v1/platform/tenants/${archived.id}/business-details`
    await expectStatus(await harness.app.request(archivedPath, { headers: operator }), 404)
    await expectStatus(
      await harness.app.request(archivedPath, {
        method: 'PUT',
        headers: { ...operator, ...json },
        body: JSON.stringify({ business_name: 'After archiving' }),
      }),
      404,
    )
  })

  test('TEN-42 a studio’s Display name is set when it is created (its Domain name when left blank) and changed on Business details; it names the studio in its apps and emails, while its Receipts carry the Business name; a blank one is refused and an absent one left as it is', async () => {
    const created = await newStudio({ business_details: { business_name: `Acme ${run} Pte. Ltd.`, display_name: ` Acme ${run} ` } })
    assert.equal((await expectStatus(await readDetails(created), 200)).business_details.display_name, `Acme ${run}`)
    const blank = await newStudio({ business_details: { display_name: '  ' } })
    assert.equal((await expectStatus(await readDetails(blank), 200)).business_details.display_name, blank.domainName)

    const studio = await newStudio()
    const [businessName, displayName] = [`Northwind ${run} Studios Pte. Ltd.`, `Northwind ${run} Studio`]
    const saved = await expectStatus(await saveDetails(studio, { business_name: businessName, display_name: displayName }), 200)
    assert.equal(saved.business_details.display_name, displayName)
    assert.equal(saved.business_details.business_name, businessName)

    const lookup = await expectStatus(
      await harness.app.request(`/api/v1/public/tenants/by-slug/${studio.slug}`, {
        headers: { 'X-Tenant-Slug': studio.slug, Origin: frontendOrigin('client', studio) },
      }),
      200,
    )
    assert.equal(lookup.settings.display_name, displayName, 'the studio’s apps call it by its Display name')

    const mia = await member(studio)
    const receipt = await receipts.issueFor(studio.id, mia.clientId, { kind: 'merch', item: 'Yoga mat' })
    const read = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${receipt.id}`, { headers: mia.headers }), 200)
    assert.equal(read.seller.business_name, businessName, 'the Receipt is the Business name’s')
    const mail = await signInCodeMail(studio, `visitor-display@${DOMAIN}`)
    assert.match(mail.from, new RegExp(`^"${displayName}" <`))

    for (const display_name of ['', '   ', null]) {
      const refused = await expectStatus(await saveDetails(studio, { business_name: businessName, display_name }), 400)
      assert.equal(refused.error, 'invalid_request')
      assert.equal(refused.message, 'A display name is required.')
    }
    const tooLong = await expectStatus(await saveDetails(studio, { business_name: businessName, display_name: 'x'.repeat(201) }), 400)
    assert.equal(tooLong.message, 'The display name is at most 200 characters.')
    await expectStatus(await saveDetails(studio, { business_name: `${businessName} Renamed` }), 200)
    assert.equal((await expectStatus(await readDetails(studio), 200)).business_details.display_name, displayName)
  })

  /** A visitor asks the studio's member app for a sign-in code: the studio's `sign_in_code` email. */
  async function signInCodeMail(at: Studio, email: string) {
    const sentBefore = mailer.discardedMail.length
    await expectStatus(
      await harness.app.request('/api/v1/auth/client/email-otp/send-verification-otp', {
        method: 'POST',
        headers: {
          ...json,
          'X-Tenant-Slug': at.slug,
          Origin: frontendOrigin('client', at),
          'X-Forwarded-For': harnessAddress(),
        },
        body: JSON.stringify({ email, type: 'sign-in' }),
      }),
      200,
    )
    const [mail] = mailer.discardedMail.slice(sentBefore).filter(m => m.to === email)
    assert.ok(mail, `a sign-in code was mailed to ${email}`)
    return { from: mail.from, subject: mail.subject, html: mail.html, text: mail.text ?? '' }
  }

  test('NTF-24 an email sent after the Admin sets a Display name comes from it, and names it in its subject and body, never the formal Business name; after a rename the next email says the new name and never the old', async () => {
    const studio = await newStudio()
    const [firstName, secondName] = [`Northwind ${run} & Co`, `Northwind ${run} Renamed & Sons`]
    const formal = `Northwind ${run} Holdings Pte. Ltd.`

    await expectStatus(await saveDetails(studio, { business_name: formal, display_name: firstName }), 200)
    const first = await signInCodeMail(studio, `visitor-first@${DOMAIN}`)
    assert.match(first.from, new RegExp(`^"${firstName}" <`), 'the From name is the Business name')
    assert.equal(first.subject, `Your ${firstName} sign-in code`)
    assert.ok(first.text.includes(`sign in to your ${firstName} account`), `the body names it: ${first.text}`)
    assert.ok(first.html.includes(`sign in to your ${firstName.replace('&', '&amp;')} account`), 'escaped in the HTML')
    for (const surface of ['from', 'subject', 'html', 'text'] as const) {
      assert.ok(!first[surface].includes(studio.domainName), `the ${surface} never names the Domain name`)
      assert.ok(!first[surface].includes(formal), `the ${surface} never names the Business name`)
    }

    await expectStatus(await saveDetails(studio, { business_name: formal, display_name: secondName }), 200)
    const second = await signInCodeMail(studio, `visitor-second@${DOMAIN}`)
    assert.match(second.from, new RegExp(`^"${secondName}" <`))
    assert.equal(second.subject, `Your ${secondName} sign-in code`)
    assert.ok(second.text.includes(`sign in to your ${secondName} account`), `the body names the new name: ${second.text}`)
    for (const surface of ['from', 'subject', 'html', 'text'] as const) {
      assert.ok(!second[surface].includes(firstName) && !second[surface].includes(firstName.replace('&', '&amp;')), `the ${surface} no longer names ${firstName}`)
    }
  })

  test('PAY-57 the charge description a member’s card statement shows is the studio’s Business name, and a rename reaches the next checkout', async () => {
    const studio = await newStudio()
    const { installStripeFake } = await import('./stripe-fake')
    const fake = installStripeFake()
    try {
      fake.ownAccount(studio)
      fake.reply('customers.create', () => ({ id: `cus_${run}_${fake.calls.length}` }))
      fake.reply('checkout.sessions.create', () => ({ id: `cs_${run}_${fake.calls.length}`, url: 'https://pay.example.test/session' }))
      const mat = await expectStatus(
        await harness.app.request('/api/v1/portal/admin/merch', {
          method: 'POST',
          headers: { ...studio.admin, ...json },
          body: JSON.stringify({ title: 'Yoga mat', price_sgd: '45' }),
        }),
        201,
      )

      /** A member buys the mat; what the payment page and the card statement are told. */
      const chargeDescription = async () => {
        const buyer = await member(studio)
        await expectStatus(
          await harness.app.request('/api/v1/me/checkout/merch', {
            method: 'POST',
            headers: { ...buyer.headers, ...json },
            body: JSON.stringify(await billed(harness.app, buyer.headers, { merch_id: mat.id })),
          }),
          200,
        )
        const session = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { line_items: any[] }
        return session.line_items.map(l => l.price_data.product_data.description as string)
      }

      const [firstName, secondName] = [`Northwind ${run} Charges`, `Northwind ${run} Charges Renamed`]
      await expectStatus(await saveDetails(studio, { business_name: firstName }), 200)
      assert.deepEqual(await chargeDescription(), [firstName])
      await expectStatus(await saveDetails(studio, { business_name: secondName }), 200)
      assert.deepEqual(await chargeDescription(), [secondName])
    } finally {
      fake.restore()
    }
  })

  test('INV-89 a Receipt issued after a Business name change names the studio by the new name in its JSON, html, PDF and email; one issued before keeps the old', async () => {
    const studio = await newStudio()
    const mia = await member(studio)
    const [oldName, newName] = [`Northwind ${run} Old Trading`, `Northwind ${run} New Trading`]

    // Merch, whose email is its Receipt, so a resend has nothing else to describe.
    const sale = { kind: 'merch', item: 'Yoga mat' } as const
    await expectStatus(await saveDetails(studio, { business_name: oldName }), 200)
    const before = await receipts.issueFor(studio.id, mia.clientId, sale)
    await expectStatus(await saveDetails(studio, { business_name: newName }), 200)
    const afterRename = await receipts.issueFor(studio.id, mia.clientId, sale)

    const seen = async (id: string) => {
      const read = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${id}`, { headers: mia.headers }), 200)
      const pdf = await harness.app.request(`/api/v1/me/receipts/${id}/pdf`, { headers: mia.headers })
      assert.equal(pdf.status, 200)
      const sentBefore = mailer.discardedMail.length
      await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/receipts/${id}/resend`, { method: 'POST', headers: studio.admin }),
        200,
      )
      const [email] = mailer.discardedMail.slice(sentBefore).filter(m => m.to === mia.email)
      assert.ok(email, 'the Receipt was emailed to the member')
      return {
        json: read.seller.business_name as string,
        html: read.html as string,
        pdf: await pdfText(new Uint8Array(await pdf.arrayBuffer())),
        email: `${email.html}\n${email.text ?? ''}`,
      }
    }

    const issuedAfter = await seen(afterRename.id)
    assert.equal(issuedAfter.json, newName)
    for (const surface of ['html', 'pdf', 'email'] as const) {
      assert.ok(issuedAfter[surface].includes(newName), `the ${surface} names the studio ${newName}: ${issuedAfter[surface]}`)
    }

    const issuedBefore = await seen(before.id)
    assert.equal(issuedBefore.json, oldName)
    for (const surface of ['html', 'pdf', 'email'] as const) {
      assert.ok(issuedBefore[surface].includes(oldName), `the ${surface} keeps ${oldName}: ${issuedBefore[surface]}`)
    }
    // The email's own words name the studio as it is now; the Receipt
    // itself, its page and its PDF, never take the new name.
    for (const surface of ['html', 'pdf'] as const) {
      assert.ok(!issuedBefore[surface].includes(newName), `the rename never reaches a Receipt already issued (${surface})`)
    }
  })
})
