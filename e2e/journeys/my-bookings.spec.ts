import { expect, test, type Page } from '@playwright/test'
import { signInMember, studio } from '../src/studio'

/**
 * Journeys: what a member holding one of everything sees in their account —
 * a class, a workshop place, a scheduled private session and a corporate
 * request, all made for them when the studio is (fe-client-features §8).
 *
 * Nothing here changes a booking, so the holder's are the same on every visit.
 */

test('ACC-02 each upcoming booking shows its own QR, and Cancel only where the member may still cancel', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.holder)

  // The account home: the next one up is the class, with its QR and its Cancel.
  await page.goto(`${urls.client}/account`)
  const upNext = page.getByRole('region', { name: 'Up next' })
  await expect(upNext.getByText(catalogue.myBookingsClassType, { exact: true })).toBeVisible()
  await expect(upNext.getByRole('button', { name: 'Show my QR' })).toBeVisible()
  await expect(upNext.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

  // My Classes is My bookings, filtered to classes.
  await page.goto(`${urls.client}/account/classes`)
  await expect(page).toHaveURL(/\/account\/bookings\?type=class$/)
  const classCard = card(page, catalogue.myBookingsClassType)
  await expect(classCard.getByRole('button', { name: 'Show QR code' })).toBeVisible()
  await expect(classCard.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

  // Every kind, each with a QR of its own.
  await page.goto(`${urls.client}/account/bookings`)
  const classAgain = card(page, catalogue.myBookingsClassType)
  const workshop = card(page, catalogue.workshopName)
  const session = card(page, '1-on-1 · Any class type')
  for (const booking of [classAgain, workshop, session]) {
    await expect(booking.getByRole('button', { name: 'Show QR code' })).toBeVisible()
  }

  // A class and a private session a week away may still be cancelled; a
  // workshop place is the studio's to change, never the member's.
  await expect(classAgain.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(session.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(workshop.getByText('To change or cancel, contact the studio.')).toBeVisible()
  await expect(workshop.getByRole('button', { name: /cancel/i })).toHaveCount(0)
})

test('CORP-05 a corporate request offers no cancel or reschedule action in the member app', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInMember(page, members.holder)

  await page.goto(`${urls.client}/account/bookings?type=corporate`)
  const request = card(page, catalogue.corporatePackageName)
  await expect(request.getByText('Pending')).toBeVisible()
  await expect(request.getByText('Not scheduled yet')).toBeVisible()
  await expect(request.getByRole('button', { name: /cancel|reschedule/i })).toHaveCount(0)
  await expect(request.getByRole('link', { name: /cancel|reschedule/i })).toHaveCount(0)
  // Nor anywhere else on the page while it is the only booking shown.
  await expect(page.getByRole('button', { name: /cancel|reschedule/i })).toHaveCount(0)
})

/** One booking's card on My bookings, by the name it leads with. */
function card(page: Page, title: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })
}
