import { expect, test, type Page } from '@playwright/test'
import { setStudioFlag, signInMember, studio } from '../src/studio'

/**
 * Journey: a member joins a full class's waitlist, sees their place, and leaves.
 *
 * The class has one online seat, already taken, and room for three in line.
 * Waitlists are the studio's switch, and a created studio starts with it off,
 * so the admin turns it on first. Joining and leaving are free — what this
 * proves is that the member app offers the line, shows the place the server
 * gave, and gives the row back when they leave.
 */
test('WTL-25 a member joins a full class waitlist, sees their place, and leaves it', async ({ page, request }) => {
  const { urls, catalogue, members } = studio()
  await setStudioFlag(request, 'waitlist_enabled', true)
  await signInMember(page, members.waiter)

  await page.goto(urls.client)
  const row = classRow(page, catalogue.waitlistClassType)
  await row.getByRole('button', { name: 'Join waitlist' }).locator('visible=true').click()

  await expect(page.getByText("Class is full — you're #1 on the waitlist.", { exact: false })).toBeVisible()
  await expect(row.getByText('On waitlist · #1').locator('visible=true')).toBeVisible()

  await page.goto(`${urls.client}/account/classes`)
  const waitlisted = page.getByRole('region', { name: 'Waitlisted' })
  await expect(waitlisted.getByText(catalogue.waitlistClassType)).toBeVisible()
  await expect(waitlisted.getByText('#1 in line')).toBeVisible()

  await waitlisted.getByRole('button', { name: 'Leave waitlist' }).click()
  await page.getByRole('dialog', { name: 'Leave this waitlist?' }).getByRole('button', { name: 'Leave waitlist' }).click()
  await expect(page.getByText('Left the waitlist.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Waitlisted' })).toHaveCount(0)

  // The line is open again, so the class offers it rather than reading Full —
  // and leaving from the row itself gives the row back the same way.
  await page.goto(urls.client)
  const again = classRow(page, catalogue.waitlistClassType)
  await again.getByRole('button', { name: 'Join waitlist' }).locator('visible=true').click()
  await expect(again.getByText('On waitlist · #1').locator('visible=true')).toBeVisible()
  await again.getByRole('button', { name: 'Leave', exact: true }).locator('visible=true').click()
  await page.getByRole('dialog', { name: 'Leave this waitlist?' }).getByRole('button', { name: 'Leave waitlist' }).click()
  await expect(again.getByRole('button', { name: 'Join waitlist' }).locator('visible=true')).toBeVisible()
})

/** The schedule row for one class, found by its name. */
function classRow(page: Page, className: string) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: className, exact: true }) })
    .filter({ has: page.getByText(/Join waitlist|On waitlist|Full/) })
    .last()
}
