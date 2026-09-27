import { expect, test, type Page } from '@playwright/test'
import { signInMember, studio } from '../src/studio'

/**
 * Journey 3: a member cancels inside the window, and the credit comes back.
 *
 * The canceller already holds the plan. They book a class days away — well
 * inside the window in which a cancellation is refunded — then cancel it, and
 * their balance is read before, between and after.
 */
test('CXL-01 a member cancels inside the window and the credit comes back', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.canceller)
  const full = catalogue.packageCredits

  await page.goto(urls.client)
  await expectCredits(page, full)

  const row = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: catalogue.cancelClassType, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Book Now' }) })
    .last()
  await row.getByRole('button', { name: 'Book Now' }).locator('visible=true').click()
  const sheet = page.getByRole('dialog', { name: `Book ${catalogue.cancelClassType}?` })
  // The Book sheet lists the member's packages with the one that will pay
  // already picked, so booking stays one tap.
  await expect(sheet.getByRole('radio', { name: catalogue.packageName })).toBeChecked()
  await sheet.getByRole('button', { name: 'Book class' }).click()
  await expect(row.getByText('Booked', { exact: true }).locator('visible=true')).toBeVisible()
  await page.reload()
  await expectCredits(page, full - 1)

  await page.goto(`${urls.client}/account/classes`)
  const booking = page
    .locator('div')
    .filter({ has: page.getByText(catalogue.cancelClassType, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
    .last()
  await booking.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(page.getByText('Booking cancelled · 1 credit returned.')).toBeVisible()

  await page.goto(urls.client)
  await expectCredits(page, full)
})

/**
 * The late cancel (#318): a member cancels a class hours away, inside its
 * window. The cancel goes through — they are warned first — and the credit it
 * spent stays spent. The class is booked for them when the studio is made, so
 * the balance is read before and after the cancel alone.
 */
test('CXL-39 a member cancels inside the window: a late cancel, and the credit stays spent', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.lateCanceller)
  const booked = catalogue.packageCredits - 1

  await page.goto(urls.client)
  await expectCredits(page, booked)

  await page.goto(`${urls.client}/account/classes`)
  const booking = page
    .locator('div')
    .filter({ has: page.getByText(catalogue.lateCancelClassType, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
    .last()
  await booking.getByRole('button', { name: 'Cancel', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel this booking?' })
  await expect(dialog.getByText("This is a late cancellation — your credit won't be returned.")).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(page.getByText("Booking cancelled · a late cancellation, so the credit wasn't returned.")).toBeVisible()

  await page.goto(urls.client)
  await expectCredits(page, booked)
})

/**
 * The balance on the member's one package card on /account, read fresh on
 * each visit; the page the journey was on is returned to after.
 */
async function expectCredits(page: Page, credits: number) {
  const { urls, catalogue } = studio()
  const back = page.url()
  await page.goto(`${urls.client}/account`)
  // The innermost card holding both the package's name and its balance.
  const card = page
    .locator('div')
    .filter({ has: page.getByText(catalogue.packageName, { exact: true }) })
    .filter({ hasText: /credits/i })
    .last()
  await expect(card).toContainText(new RegExp(`(^|\\D)${credits}\\s*credits`, 'i'))
  await page.goto(back)
}
