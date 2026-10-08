import { expect, test, type Page } from '@playwright/test'
import { closeBookedCelebration, openDayOf } from '../src/schedule'
import { completeMemberLogin, signInMember, studio, visitSignedOut } from '../src/studio'

/**
 * Journeys: where signing in sends a member, and what a member who holds
 * nothing is told when they try to book (fe-client-features §1.3, §3.1).
 */

test('AUTH-07 a signed-out visitor who taps Log in on a members-only page is returned to it after signing in', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await visitSignedOut(page)

  await page.goto(`${urls.client}/workshops`)
  await page.getByRole('link', { name: 'Log in', exact: true }).last().click()
  await expect(page).toHaveURL(/\/login\?next=%2Fworkshops$/)
  await completeMemberLogin(page, members.newcomer)

  // Back on Workshops, now signed in, where the studio's workshop is listed.
  await expect(page).toHaveURL(`${urls.client}/workshops`)
  await expect(page.getByText(catalogue.workshopName, { exact: true }).first()).toBeVisible()
})

test('CAT-06 a signed-out visitor who taps Book Now is returned to that class Book sheet after signing in', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await visitSignedOut(page)

  await page.goto(urls.client)
  await openDayOf(page, catalogue.buyClassType)
  await classRow(page, catalogue.buyClassType).getByRole('button', { name: 'Book Now' }).locator('visible=true').click()
  await expect(page).toHaveURL(/\/login\?next=/)
  await completeMemberLogin(page, members.returner)

  // The class they tapped, ready to book: its own Book sheet, the plan picked.
  const sheet = page.getByRole('dialog', { name: `Book ${catalogue.buyClassType}?` })
  await expect(sheet.getByRole('radio', { name: catalogue.packageName })).toBeChecked()
  await sheet.getByRole('button', { name: 'Book class' }).click()
  await closeBookedCelebration(page)
  await expect(
    classRow(page, catalogue.buyClassType).getByText('Booked', { exact: true }).locator('visible=true'),
  ).toBeVisible()
})

test('BKG-20 a member holding nothing who taps Book Now is offered a package and nothing is booked', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.newcomer)
  const bookingRequests: string[] = []
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/me/bookings/class')) bookingRequests.push(req.url())
  })

  await page.goto(urls.client)
  await openDayOf(page, catalogue.buyClassType)
  await classRow(page, catalogue.buyClassType).getByRole('button', { name: 'Book Now' }).locator('visible=true').click()

  const popup = page.getByRole('dialog', { name: 'You need a package to book this class' })
  await expect(popup).toBeVisible()
  await popup.getByRole('link', { name: 'Buy a Package' }).click()
  await expect(page).toHaveURL(`${urls.client}/packages`)
  await expect(page.getByText(catalogue.packageName, { exact: true }).first()).toBeVisible()
  expect(bookingRequests).toEqual([])
})

/** The schedule row for one class with a Book Now, found by its name. */
function classRow(page: Page, className: string) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: className, exact: true }) })
    .filter({ has: page.getByRole('button', { name: /Book Now|Booked/ }) })
    .last()
}
