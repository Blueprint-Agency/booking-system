/**
 * features/member-checkout-receipt.md: the `buyer` (no plan) buys the studio's
 * class package with the stub's test card, opens the Receipt from the
 * confirmation, finds it again in /account/receipts, and books a class on the
 * new credits. Proof: screenshots and ARIA at each state, plus the rows the
 * purchase wrote (purchase, payment, receipt, email_log, client package, booking).
 *
 *   node .claude/skills/verify-booking-system/scripts/drive.mjs .claude/skills/verify-booking-system/drives/member-buy-receipt-book.mjs
 */
export default async ({ page, studio, signInMember, step, shot, aria, sql, expect }) => {
  const { urls, catalogue, members, tenantId } = studio
  const price = `S$${Number(catalogue.packagePriceSgd).toFixed(2)}`

  step(`sign in as buyer ${members.buyer.email} (holds no plan)`)
  await signInMember(page, members.buyer)

  step('open Packages and choose Purchase on the studio package')
  await page.goto(`${urls.client}/packages`)
  const plan = page
    .locator('div')
    .filter({ has: page.getByText(catalogue.packageName, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Purchase' }) })
    .last()
  await expect(plan).toBeVisible()
  await shot('packages')
  await plan.getByRole('button', { name: 'Purchase' }).click()

  step('checkout: Pay, then the Stripe stub page with the 4242 test card')
  const pay = page.getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ })
  await expect(pay).toBeVisible()
  await shot('checkout')
  await pay.click()
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  await page.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242')
  await page.getByRole('textbox', { name: /expiration/i }).fill('12 / 34')
  await page.getByRole('textbox', { name: 'CVC' }).fill('123')
  await page.getByRole('textbox', { name: 'Cardholder name' }).fill('Verify Buyer')
  await shot('stripe-stub')
  await page.getByRole('button', { name: 'Pay', exact: true }).click()

  step('confirmation: all set, credits added, receipt link')
  await expect(page.getByText("You're all set!")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(`${catalogue.packageCredits} class credits added`)).toBeVisible()
  await shot('confirmation')
  await aria('confirmation')
  const receiptLink = page.getByRole('link', { name: /^View receipt R-\d{6}$/ })
  const receiptNumber = (await receiptLink.textContent()).match(/R-\d{6}/)[0]
  step(`receipt ${receiptNumber}`)
  await receiptLink.click()

  step('receipt page: heading, total and plan inside the receipt frame')
  await expect(page).toHaveURL(new RegExp(`${urls.client}/account/receipts/[0-9a-f-]{36}$`))
  await expect(page.getByRole('heading', { name: `Receipt ${receiptNumber}` })).toBeVisible()
  const receipt = page.getByTitle(`Receipt ${receiptNumber}`).contentFrame()
  await expect(receipt.getByText(price).first()).toBeVisible()
  await expect(receipt.getByText(catalogue.packageName, { exact: true })).toBeVisible()
  await shot('receipt')

  step('second view: the receipt is listed in /account/receipts')
  await page.goto(`${urls.client}/account/receipts`)
  await expect(page.getByText(receiptNumber).first()).toBeVisible()
  await shot('receipts-list')
  await aria('receipts-list')

  step(`book ${catalogue.buyClassType} on the new credits`)
  await page.goto(urls.client)
  const day = page
    .locator('section:has(> h2 > button[aria-controls^="day-"])')
    .filter({ has: page.getByRole('heading', { name: catalogue.buyClassType, exact: true }) })
    .last()
  const header = day.locator(':scope > h2 > button')
  await expect(async () => {
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
  }).toPass()
  const row = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: catalogue.buyClassType, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Book Now' }) })
    .last()
  await row.getByRole('button', { name: 'Book Now' }).locator('visible=true').click()
  const sheet = page.getByRole('dialog', { name: `Book ${catalogue.buyClassType}?` })
  await expect(sheet.getByRole('radio', { name: catalogue.packageName })).toBeChecked()
  await shot('book-sheet')
  await sheet.getByRole('button', { name: 'Book class' }).click()
  const booked = page.getByRole('dialog', { name: "You're booked!" })
  await expect(booked).toBeVisible()
  await shot('booked')
  await booked.getByRole('button', { name: 'Done' }).click()
  await expect(row.getByText('Booked', { exact: true }).locator('visible=true')).toBeVisible()

  step('side effects in the database')
  const buyer = `(select c.id from clients c where c.tenant_id = '${tenantId}' and lower(c.email) = lower('${members.buyer.email}'))`
  sql('purchases', `select id, status, total_sgd, created_at from purchases where tenant_id = '${tenantId}' and client_id = ${buyer}`)
  sql('stripe-payments', `select id, status, amount_sgd, method, card_last4, created_at from stripe_payments where tenant_id = '${tenantId}' and client_id = ${buyer}`)
  const receipts = sql('receipts', `select number, display_number, total_sgd, issued_at, buyer_email from receipts where tenant_id = '${tenantId}' and client_id = ${buyer}`)
  if (!receipts.includes(receiptNumber)) throw new Error(`no receipts row for ${receiptNumber}`)
  sql('client-packages', `select cp.id, cp.credits_or_sessions_remaining, cp.active from client_packages cp where cp.tenant_id = '${tenantId}' and cp.client_id = ${buyer}`)
  sql('bookings', `select b.id, b.state, b.class_id = '${studio.classes.buy.id}' as is_buy_class from bookings b where b.tenant_id = '${tenantId}' and b.client_id = ${buyer}`)
  sql('email-log', `select template_slug, recipient_email, status, subject_rendered from email_log where tenant_id = '${tenantId}' and recipient_email = '${members.buyer.email}' order by queued_at`)
}
