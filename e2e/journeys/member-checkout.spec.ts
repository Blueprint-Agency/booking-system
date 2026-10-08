import { expect, test, type Frame, type Page } from '@playwright/test'
import { completeMemberLogin, signInMember, studio, visitSignedOut } from '../src/studio'

/**
 * Journeys: buying from the member app — packages through the /checkout
 * review step, merch straight to the payment provider — and the sign-in gate
 * in front of both (fe-client-features §2.2, §6b, §7).
 *
 * Local stack only, like buy-and-book: a studio takes payments on its own
 * account (#293), which only the Stripe stub plays for a throwaway studio.
 */

test('CAT-02 an anonymous visitor on /pricing reads the packages catalogue and cannot buy without signing in', async ({ page }) => {
  const { urls, catalogue } = studio()
  await visitSignedOut(page)
  const checkouts = postsTo(page, '/me/checkout/')

  await page.goto(`${urls.client}/pricing`)
  // The same catalogue, not a second copy of it: /pricing is /packages.
  await expect(page).toHaveURL(`${urls.client}/packages`)
  const card = packageCard(page, catalogue.packageName)
  await expect(card.getByText(new RegExp(`\\$${Number(catalogue.packagePriceSgd)}(\\.00)?$`)).first()).toBeVisible()

  await card.getByRole('button', { name: 'Purchase' }).click()
  const gate = page.getByRole('dialog', { name: 'Log in to buy a package' })
  await expect(gate.getByRole('link', { name: 'Log in' })).toBeVisible()
  await expect(page).toHaveURL(`${urls.client}/packages`)
  expect(checkouts).toEqual([])
})

test('PAY-01 a signed-out visitor who taps Purchase passes the login gate and lands on the checkout review step', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await visitSignedOut(page)

  await page.goto(`${urls.client}/packages`)
  await packageCard(page, catalogue.packageName).getByRole('button', { name: 'Purchase' }).click()
  await page.getByRole('dialog', { name: 'Log in to buy a package' }).getByRole('link', { name: 'Log in' }).click()
  await completeMemberLogin(page, members.newcomer)

  await expect(page).toHaveURL(/\/checkout\?package=[^&]+&kind=class$/)
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await expect(page.getByText(catalogue.packageName, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ })).toBeVisible()
})

test('PAY-13 a declined card shows an inline error, keeps the form, and a retry pays once', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.shopper)

  await page.goto(`${urls.client}/packages`)
  await packageCard(page, catalogue.packageName).getByRole('button', { name: 'Purchase' }).click()
  await page.getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ }).click()

  const form = await cardForm(page)
  await form.getByRole('textbox', { name: 'Card number' }).fill('4000 0000 0000 0002')
  await form.getByRole('textbox', { name: /expiration/i }).fill('12 / 34')
  await form.getByRole('textbox', { name: /CVC/ }).fill('123')
  await form.getByRole('textbox', { name: 'Cardholder name' }).fill('E2E Shopper')
  await form.getByRole('button', { name: 'Pay', exact: true }).click()

  // Refused in place: the error beside the form, and what was typed still there.
  const retry = await cardForm(page)
  await expect(retry.getByRole('alert')).toHaveText('Your card was declined.')
  await expect(retry.getByRole('textbox', { name: /expiration/i })).toHaveValue('12 / 34')
  await expect(retry.getByRole('textbox', { name: /CVC/ })).toHaveValue('123')
  await expect(retry.getByRole('textbox', { name: 'Cardholder name' })).toHaveValue('E2E Shopper')

  await retry.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242')
  await retry.getByRole('button', { name: 'Pay', exact: true }).click()
  await expect(page.getByText("You're all set!")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(`${catalogue.packageCredits} class credits added`)).toBeVisible()

  // One package, bought once.
  await page.goto(`${urls.client}/account/packages`)
  await expect(page.getByText(catalogue.packageName, { exact: true })).toHaveCount(1)
})

test('MRC-02 a signed-out visitor who taps Buy on merch passes the sign-in gate and returns to /merch', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await visitSignedOut(page)

  await page.goto(`${urls.client}/merch`)
  await merchCard(page, catalogue.merchName).getByRole('button', { name: 'Buy' }).click()
  await page.getByRole('dialog', { name: 'Log in to buy merch' }).getByRole('link', { name: 'Log in' }).click()
  await completeMemberLogin(page, members.merchBuyer)

  await expect(page).toHaveURL(`${urls.client}/merch`)
  await expect(merchCard(page, catalogue.merchName).getByRole('button', { name: 'Buy' })).toBeVisible()
})

test('MRC-03 Buy on merch goes straight to the payment provider for one item, with no review step', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.merchBuyer)
  const visited: string[] = []
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  await page.goto(`${urls.client}/merch`)
  await expect(page.getByText('Pay online, collect at the front desk on your next visit.')).toBeVisible()
  await merchCard(page, catalogue.merchName).getByRole('button', { name: 'Buy' }).click()

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  // One item at its own price: no quantity was asked, no code taken off.
  await expect(page.getByRole('heading', { name: `Pay S$${catalogue.merchPriceSgd}` })).toBeVisible()
  // Nothing between the shop and the provider: no /checkout review page.
  expect(visited.filter(u => new URL(u).pathname.startsWith('/checkout'))).toEqual([])

  const form = await cardForm(page)
  await form.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242')
  await form.getByRole('textbox', { name: /expiration/i }).fill('12 / 34')
  await form.getByRole('textbox', { name: /CVC/ }).fill('123')
  await form.getByRole('textbox', { name: 'Cardholder name' }).fill('E2E Merch Buyer')
  await form.getByRole('button', { name: 'Pay', exact: true }).click()
  await expect(page.getByText(/hand your merch over to you physically at the studio/)).toBeVisible({ timeout: 60_000 })
})

/** The innermost card on /packages naming this package and offering Purchase. */
function packageCard(page: Page, name: string) {
  return page
    .locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Purchase' }) })
    .last()
}

/** The merch item's card, by its title. */
function merchCard(page: Page, title: string) {
  return page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

/** The URLs of the POSTs this page makes to API paths containing `fragment`, as they happen. */
function postsTo(page: Page, fragment: string): string[] {
  const seen: string[] = []
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().includes(fragment)) seen.push(req.url())
  })
  return seen
}

/**
 * The payment provider's card form, found by what it holds: Stripe keeps it in
 * a frame of its own (buy-and-book.spec.ts), the stub on the page itself.
 */
async function cardForm(page: Page): Promise<Frame> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  const cardNumber = (frame: Frame) => frame.getByRole('textbox', { name: 'Card number' })
  let form: Frame | undefined
  await expect
    .poll(async () => {
      for (const frame of page.frames()) if (await cardNumber(frame).count()) form = frame
      return Boolean(form)
    }, { timeout: 60_000 })
    .toBe(true)
  return form!
}
