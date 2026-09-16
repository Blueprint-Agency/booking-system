import { expect, test, type Page } from '@playwright/test'
import { signInMember, studio } from '../src/studio'

/**
 * Journey 3: a member cancels inside the window, and the credit comes back.
 *
 * The canceller already holds the plan. They book a class days away — well
 * inside the window in which a cancellation is refunded — then cancel it, and
 * their balance is read before, between and after.
 */
test('a member cancels inside the window and the credit comes back', async ({ page }) => {
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

/** The balance in the member app's top bar, which reads it fresh on each page load. */
async function expectCredits(page: Page, credits: number) {
  await expect(page.getByTitle('Class credits').locator('visible=true').first()).toHaveText(
    new RegExp(`^\\s*${credits}\\s*class credits`),
  )
}
