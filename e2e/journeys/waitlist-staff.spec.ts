import { expect, test } from '@playwright/test'
import { signInStaff, studio } from '../src/studio'

/**
 * Journey: staff work a class's waitlist from its session page (#310).
 *
 * The class has one online seat, taken, one buffer seat free, and two members
 * already in line. The admin sees the line in order with what each would pay
 * with, adds the first to the class — into the buffer seat — and removes the
 * second. The line is worked whatever the studio's waitlist switch says, so the
 * journey leaves it alone.
 */
test('WTL-26 staff see a class waitlist, add the first member to the class, and remove the next', async ({ page }) => {
  const { urls, catalogue, classes, staff, staffWaitlistLine } = studio()
  const [first, second] = staffWaitlistLine as [string, string]

  await signInStaff(page, staff.admin)
  await page.waitForURL(/\/admin/)
  await page.goto(`${urls.portal}/admin/schedule/class/${classes.staffWaitlist.id}`)

  const panel = page.getByRole('region', { name: 'Waitlist' })
  const rows = panel.getByTestId('waitlist-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('#1')
  await expect(rows.nth(0)).toContainText(first)
  await expect(rows.nth(0)).toContainText(`Pending: ${catalogue.packageName}`)
  await expect(rows.nth(1)).toContainText('#2')
  await expect(rows.nth(1)).toContainText(second)

  // Add to class: the online seat is taken, so the first in line takes the buffer seat.
  await rows.nth(0).getByRole('button', { name: 'Add to class' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toContainText('#1')
  await expect(rows.nth(0)).toContainText(second)
  const booked = page.locator('li').filter({ hasText: first }).filter({ hasText: 'Promoted from waitlist' })
  await expect(booked).toBeVisible()
  await expect(booked.getByText('Buffer', { exact: true })).toBeVisible()

  // Remove: asked once, then gone, and the line is empty.
  await rows.nth(0).getByRole('button', { name: 'Remove' }).click()
  await rows.nth(0).getByRole('button', { name: 'Remove' }).click()
  await expect(panel.getByText('Nobody is waiting.')).toBeVisible()
  await expect(page.locator('li').filter({ hasText: second })).toHaveCount(0)
})
