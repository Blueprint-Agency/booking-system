import { expect, test } from '@playwright/test'
import { closeBookedCelebration, openDayOf } from '../src/schedule'
import { signInMember, studio } from '../src/studio'

/**
 * Journey: a member opens a class's detail from the schedule and books from it (#323).
 *
 * Tapping a class row opens the detail overlay: the class, its time, where and
 * with whom, which packages it accepts, and the member's own packages marked
 * as able to pay or not. Its Book button opens the same Book sheet the row's
 * does. The waiter holds the studio's plan and spends nothing in their own
 * journey, so the credit this one spends is theirs to spend.
 */
test('BKG-06, BKG-30 a member opens a class detail overlay from the schedule and books from it', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.waiter)

  await page.goto(urls.client)
  await openDayOf(page, catalogue.buyClassType)
  const row = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: catalogue.buyClassType, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Book Now' }) })
    .last()
  // The row itself is the way in: a button stretched under it, named for the class.
  await page.getByRole('button', { name: `Details: ${catalogue.buyClassType},` }).locator('visible=true').click()

  const detail = page.getByRole('dialog', { name: catalogue.buyClassType, exact: true })
  await expect(detail.getByText('All packages')).toBeVisible()
  // Signed in, the member's own plan is listed, and nothing says it cannot pay.
  const mine = detail.getByRole('list', { name: 'Your packages' })
  await expect(mine.getByText(catalogue.packageName, { exact: true })).toBeVisible()
  await expect(mine.getByRole('img', { name: 'Can pay' })).toBeVisible()

  await detail.getByRole('button', { name: 'Book Now' }).click()
  await expect(detail).toBeHidden()
  const sheet = page.getByRole('dialog', { name: `Book ${catalogue.buyClassType}?` })
  // The same Book sheet the row opens, with the plan already picked.
  await expect(sheet.getByRole('radio', { name: catalogue.packageName })).toBeChecked()
  await sheet.getByRole('button', { name: 'Book class' }).click()
  await closeBookedCelebration(page)
  await expect(row.getByText('Booked', { exact: true }).locator('visible=true')).toBeVisible()

  // A class the member is booked into opens the same way, and says so.
  await page.getByRole('button', { name: `Details: ${catalogue.buyClassType},` }).locator('visible=true').click()
  await expect(detail.getByText("You're booked into this class")).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
})
