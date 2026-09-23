import { expect, test } from '@playwright/test'
import { signInMember, signInStaff, studio } from '../src/studio'

/**
 * Journey 4: a member books, shows their code at the desk, and is checked in (#192).
 *
 * The class starts minutes from now — inside the studio's Check-in Window, so
 * this is the early arrival the window exists for. The desk types the code the
 * member's full-screen QR shows under it; a camera cannot be pointed at a
 * headless browser, and the QR encodes the same booking (the backend suite
 * covers the scan by token).
 */
test('a member shows their code at the desk and is checked in', async ({ browser }) => {
  const { urls, catalogue, members, staff } = studio()

  const member = await browser.newPage({ viewport: { width: 360, height: 740 } })
  await signInMember(member, members.arriver)
  await member.goto(urls.client)
  const row = member
    .locator('div')
    .filter({ has: member.getByRole('heading', { name: catalogue.checkInClassType, exact: true }) })
    .filter({ has: member.getByRole('button', { name: 'Book Now' }) })
    .last()
  await row.getByRole('button', { name: 'Book Now' }).locator('visible=true').click()
  await expect(row.getByText('Booked', { exact: true }).locator('visible=true')).toBeVisible()

  await member.reload()
  const card = member.getByTestId('next-class-card')
  await expect(card).toContainText(catalogue.checkInClassType)
  await card.getByTestId('next-class-show-qr').click()
  const dialog = member.getByTestId('booking-qr-dialog')
  await expect(dialog.getByRole('img', { name: 'Check-in QR code' })).toBeVisible()
  const code = (await dialog.getByTestId('booking-qr-code').innerText()).trim()
  expect(code).toMatch(/^RT-[0-9A-Z]{6}$/)

  const desk = await browser.newPage()
  await signInStaff(desk, staff.admin)
  await desk.waitForURL(/\/admin/)
  await desk.goto(`${urls.portal}/admin/check-in`)
  const entry = desk.locator(`[data-testid="check-in-roster-row"][data-booking-code="${code}"]`)
  await expect(entry).toHaveAttribute('data-check-in-state', 'pending')

  // Typed as a person reads it off a phone: lower case is fine.
  await desk.getByTestId('check-in-code-input').fill(code.toLowerCase())
  await desk.getByTestId('check-in-code-submit').click()
  await expect(desk.getByTestId('check-in-result')).toHaveAttribute('data-outcome', 'checked_in')
  await expect(entry).toHaveAttribute('data-check-in-state', 'attended')

  // The same code again is a friendly no-op.
  await desk.getByTestId('check-in-code-input').fill(code)
  await desk.getByTestId('check-in-code-submit').click()
  await expect(desk.getByTestId('check-in-result')).toHaveAttribute('data-outcome', 'already_checked_in')

  // And the member sees it on their own phone.
  await member.reload()
  await expect(member.getByTestId('next-class-checked-in')).toBeVisible()
})
