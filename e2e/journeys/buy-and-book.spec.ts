import { expect, test, type Frame, type Page } from '@playwright/test'
import { signInMember, studio } from '../src/studio'

/**
 * Journey 1: a member buys a plan with a Stripe test card and books a class.
 *
 * The buyer holds no plan, so the credit they book with can only have come from
 * this purchase. Payment is Stripe's own hosted Checkout, in test mode.
 */
test('PAY-16 a member buys a plan with a test card and books a class', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.buyer)

  await page.goto(`${urls.client}/packages`)
  const plan = page
    .locator('div')
    .filter({ has: page.getByText(catalogue.packageName, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Purchase' }) })
    .last()
  await plan.getByRole('button', { name: 'Purchase' }).click()

  await page.getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ }).click()
  await payWithTestCard(page)

  await expect(page.getByText("You're all set!")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(`${catalogue.packageCredits} class credits added`)).toBeVisible()

  await page.goto(urls.client)
  const row = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: catalogue.buyClassType, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Book Now' }) })
    .last()
  await row.getByRole('button', { name: 'Book Now' }).locator('visible=true').click()
  await page
    .getByRole('dialog', { name: `Book ${catalogue.buyClassType}?` })
    .getByRole('button', { name: 'Book class' })
    .click()
  await expect(row.getByText('Booked', { exact: true }).locator('visible=true')).toBeVisible()
})

/** Stripe's hosted Checkout page, paid with the card that always succeeds. */
async function payWithTestCard(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  // The email is prefilled from the member's account. The card form lives in a
  // frame of Stripe's own, and which frame has moved before — so it is found by
  // what it holds rather than by its name.
  const cardNumber = (frame: Frame) => frame.getByRole('textbox', { name: 'Card number' })
  await expect
    .poll(async () => {
      for (const frame of page.frames()) if (await cardNumber(frame).count()) return true
      return false
    }, { timeout: 60_000 })
    .toBe(true)
  let form!: Frame
  for (const frame of page.frames()) if (await cardNumber(frame).count()) form = frame

  await cardNumber(form).fill('4242 4242 4242 4242')
  await form.getByRole('textbox', { name: /expiration/i }).fill('12 / 34')
  await form.getByRole('textbox', { name: /CVC/ }).fill('123')
  await form.getByRole('textbox', { name: 'Cardholder name' }).fill('E2E Buyer')

  // Stripe shapes the form by where the browser appears to be. From a US runner
  // it defaults the country to the United States (asking for a ZIP) and ticks
  // "Save my information" for Link, which then requires a phone number and
  // leaves Pay doing nothing. So the country is set to the studio's own, and
  // Link is declined — the journey is paying by card, not signing up to Link.
  const country = form.getByRole('combobox', { name: 'Country or region' })
  if (await country.isVisible().catch(() => false)) await country.selectOption({ label: 'Singapore' })
  const postal = form.getByRole('textbox', { name: /postal|ZIP/i })
  if (await postal.isVisible().catch(() => false)) await postal.fill('018956')
  for (const frame of page.frames()) {
    const saveForLink = frame.getByRole('checkbox', { name: /Save my information/i })
    if ((await saveForLink.count()) && (await saveForLink.isChecked())) await saveForLink.uncheck()
  }
  await form.getByRole('button', { name: 'Pay', exact: true }).click()
}
