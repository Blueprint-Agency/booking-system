import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { receiptFixtures } from './receipt-fixtures'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-details.test`
const OPERATOR = `operator@${DOMAIN}`

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/**
 * A studio's receipt details (#391): the prefix its Receipt numbers carry, and
 * the legal name, registration number, address and footer note its Receipts
 * print. Rows the studio owns, set by its admin in the portal's studio settings
 * or by the operator when the super portal creates the studio, and copied onto
 * each Receipt as it is issued, so a later edit never reaches one already
 * issued.
 *
 * Every studio here is created by the super portal over HTTP, so its numbering
 * starts at 1 and the numbers asserted are the studio's own. The Receipts are
 * issued the way a settled sale issues them (`receipt-fixtures.ts`) and read
 * back as the member reads them: `/me/receipts/:id` and its PDF.
 *
 * Written from the INV rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('a studio’s receipt details', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receipts!: ReturnType<typeof receiptFixtures>
  let operator!: Record<string, string>

  type Studio = { id: string; slug: string; admin: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  const json = { 'Content-Type': 'application/json' }
  const DETAILS_PATH = '/api/v1/portal/admin/settings/receipt-details'

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  let studios = 0
  /** A studio the super portal creates, with a first admin who has taken up their invitation. */
  async function newStudio(extra: Record<string, unknown> = {}): Promise<Studio> {
    const slug = `rd-${run}-${studios++}`
    const adminEmail = `admin-${slug}@${DOMAIN}`
    const created = await expectStatus(
      await harness.app.request('/api/v1/platform/tenants', {
        method: 'POST',
        headers: { ...operator, ...json },
        body: JSON.stringify({ slug, name: `Receipt details ${slug}`, admin_email: adminEmail, ...extra }),
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
    return { id: tenantId, slug, admin: await harness.signInAs('staff', adminEmail, { slug }) }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
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

  const readDetails = (at: Studio, headers = at.admin) => harness.app.request(DETAILS_PATH, { headers })
  const saveDetails = (at: Studio, body: unknown, headers = at.admin) =>
    harness.app.request(DETAILS_PATH, { method: 'PUT', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receipts = receiptFixtures(harness)
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await receipts?.cleanup()
    const ours = `%@${DOMAIN}`
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('INV-40 an admin saves the studio’s receipt details and reads them back, with the number the next Receipt will take', async () => {
    const studio = await newStudio()

    const fresh = await expectStatus(await readDetails(studio), 200)
    assert.deepEqual(fresh, {
      receipt_details: { prefix: 'R', legal_name: null, registration_number: null, address: null, footer: null },
      next_number: 'R-000001',
      next_sequence: 1,
    })

    const details = {
      prefix: 'R',
      legal_name: `Legal ${run} Pte. Ltd.`,
      registration_number: `2026${run}`,
      address: `1 Example Street\n#02-03\nSingapore 000001`,
      footer: 'Thank you for practising with us.',
    }
    const saved = await expectStatus(await saveDetails(studio, details), 200)
    assert.deepEqual(saved, { receipt_details: details, next_number: 'R-000001', next_sequence: 1 })
    assert.deepEqual(await expectStatus(await readDetails(studio), 200), saved, 'what was saved is what is read')
  })

  test('INV-41 the next Receipt and its PDF carry the details saved; one issued before keeps what it was issued with', async () => {
    const studio = await newStudio()
    const mia = await member(studio)
    const before = await receipts.issueFor(studio.id, mia.clientId)

    const details = {
      prefix: 'R',
      legal_name: `Legal ${run} Pte. Ltd.`,
      registration_number: `UEN ${run}`,
      address: '1 Example Street, Singapore 000001',
      footer: 'Thank you for practising with us.',
    }
    await expectStatus(await saveDetails(studio, details), 200)
    const afterSave = await receipts.issueFor(studio.id, mia.clientId)

    const seller = async (id: string) =>
      (await expectStatus(await harness.app.request(`/api/v1/me/receipts/${id}`, { headers: mia.headers }), 200)).seller
    const pdf = async (id: string) => {
      const res = await harness.app.request(`/api/v1/me/receipts/${id}/pdf`, { headers: mia.headers })
      assert.equal(res.status, 200)
      return pdfText(new Uint8Array(await res.arrayBuffer()))
    }

    const issuedAfter = await seller(afterSave.id)
    assert.equal(issuedAfter.legal_name, details.legal_name)
    assert.equal(issuedAfter.registration_number, details.registration_number)
    assert.equal(issuedAfter.address, details.address)
    assert.equal(issuedAfter.footer, details.footer)
    const afterText = await pdf(afterSave.id)
    for (const value of [details.legal_name, details.registration_number, details.address, details.footer]) {
      assert.ok(afterText.includes(value), `the PDF prints ${value}: ${afterText}`)
    }

    const issuedBefore = await seller(before.id)
    assert.deepEqual(
      [issuedBefore.legal_name, issuedBefore.registration_number, issuedBefore.address, issuedBefore.footer],
      [null, null, null, null],
      'a Receipt issued before the details were saved carries none of them',
    )
    const beforeText = await pdf(before.id)
    assert.ok(!beforeText.includes(details.legal_name) && !beforeText.includes(details.footer), beforeText)

    // A later edit reaches neither of them.
    await expectStatus(await saveDetails(studio, { ...details, legal_name: `Renamed ${run} Pte. Ltd.`, footer: null }), 200)
    assert.equal((await seller(afterSave.id)).legal_name, details.legal_name)
    assert.equal((await seller(afterSave.id)).footer, details.footer)
    assert.ok(!(await pdf(afterSave.id)).includes('Renamed'), 'the PDF is drawn from what the Receipt was issued with')
  })

  test('INV-42 a new prefix numbers the next Receipt on from the same sequence, leaves earlier numbers as issued, and the preview names it', async () => {
    const studio = await newStudio()
    const mia = await member(studio)
    const numbersListed = async () =>
      (await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: mia.headers }), 200)).receipts
        .map((r: { number: string }) => r.number)
        .sort()

    await receipts.issueFor(studio.id, mia.clientId)
    await receipts.issueFor(studio.id, mia.clientId)
    assert.equal((await expectStatus(await readDetails(studio), 200)).next_number, 'R-000003')

    const saved = await expectStatus(await saveDetails(studio, { prefix: 'NW' }), 200)
    assert.equal(saved.receipt_details.prefix, 'NW')
    assert.equal(saved.next_number, 'NW-000003', 'the preview: the new prefix, the sequence carrying on')
    assert.equal(saved.next_sequence, 3)

    const next = await receipts.issueFor(studio.id, mia.clientId)
    assert.equal(next.displayNumber, saved.next_number, 'the next Receipt takes the number the preview named')
    assert.deepEqual(await numbersListed(), ['NW-000003', 'R-000001', 'R-000002'], 'earlier Receipts keep their numbers')
    assert.equal((await expectStatus(await readDetails(studio), 200)).next_number, 'NW-000004')
  })

  test('INV-43 the super portal sets the receipt details when it creates a studio, and the studio’s first Receipt carries them', async () => {
    const details = {
      prefix: 'AC',
      legal_name: `Created ${run} Pte. Ltd.`,
      registration_number: `REG ${run}`,
      address: '2 Example Road, Singapore 000002',
      footer: 'See you on the mat.',
    }
    const studio = await newStudio({ receipt_details: details })
    assert.deepEqual(await expectStatus(await readDetails(studio), 200), {
      receipt_details: details,
      next_number: 'AC-000001',
      next_sequence: 1,
    })

    const mia = await member(studio)
    const first = await receipts.issueFor(studio.id, mia.clientId)
    const read = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${first.id}`, { headers: mia.headers }), 200)
    assert.equal(read.number, 'AC-000001')
    assert.equal(read.seller.legal_name, details.legal_name)
    assert.equal(read.seller.footer, details.footer)

    // A prefix that could not head a number is refused before any studio is made.
    const slug = `rd-${run}-refused`
    const refused = await expectStatus(
      await harness.app.request('/api/v1/platform/tenants', {
        method: 'POST',
        headers: { ...operator, ...json },
        body: JSON.stringify({ slug, name: 'Refused studio', receipt_details: { prefix: 'R 1' } }),
      }),
      400,
    )
    assert.equal(refused.error, 'invalid_request')
    assert.match(refused.message, /prefix/)
    assert.deepEqual(await harness.db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)), [])
  })

  test('INV-44 an instructor can neither read nor change the receipt details, and an admin’s unusable prefix or overlong detail is refused', async () => {
    const studio = await newStudio()
    const details = { prefix: 'R', legal_name: `Kept ${run} Pte. Ltd.`, registration_number: null, address: null, footer: null }
    await expectStatus(await saveDetails(studio, details), 200)

    const instructorEmail = `instructor-${run}@${DOMAIN}`
    const instructor = await harness.signInAs('staff', instructorEmail, studio)
    const [account] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, instructorEmail))
    await harness.db.insert(schema.staffUsers).values({
      tenantId: studio.id,
      email: instructorEmail,
      name: 'An Instructor',
      role: 'instructor',
      status: 'active',
      authUserId: account!.id,
    })

    assert.equal((await expectStatus(await readDetails(studio, instructor), 403)).error, 'forbidden_role')
    const change = await saveDetails(studio, { ...details, legal_name: 'Not theirs to set' }, instructor)
    assert.equal((await expectStatus(change, 403)).error, 'forbidden_role')

    for (const [body, about] of [
      [{ prefix: 'R/1' }, /prefix/],
      [{ prefix: '-R' }, /prefix/],
      [{ prefix: 'ABCDEFGHIJK' }, /prefix/],
      [{ legal_name: 'x'.repeat(201) }, /legal name/],
      [{ footer: 'x'.repeat(1001) }, /footer/],
    ] as const) {
      const refused = await expectStatus(await saveDetails(studio, body), 400)
      assert.equal(refused.error, 'invalid_request')
      assert.match(refused.message, about)
    }
    assert.deepEqual(
      (await expectStatus(await readDetails(studio), 200)).receipt_details,
      details,
      'nothing refused changed what the studio has',
    )
  })
})
