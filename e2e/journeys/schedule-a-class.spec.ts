import { expect, test } from '@playwright/test'
import { signInStaff, studio } from '../src/studio'

/**
 * Journey 2: an admin creates a class, and an instructor sees it on their schedule.
 *
 * The class type is one nothing
 * else in the studio is scheduled under, so the instructor can only be seeing
 * the class this journey made. The two people use separate browser contexts,
 * as two people on two machines would.
 */
test('an admin creates a class and the instructor sees it on their schedule', async ({ browser }) => {
  const { urls, staff, catalogue } = studio()
  const day = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  const date = day.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }) // YYYY-MM-DD

  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInStaff(admin, staff.admin)
  await admin.waitForURL(/\/admin/)

  await admin.goto(`${urls.portal}/admin/schedule/new/class`)
  await expect(admin.getByRole('heading', { name: 'New class' })).toBeVisible()
  const field = (label: string) => admin.getByLabel(label, { exact: true })
  await field('Class type').selectOption({ label: catalogue.portalClassType })
  await field('Main instructor').selectOption({ label: staff.instructor.name })
  await field('Main instructor pay (S$)').fill('50')
  await field('Room').selectOption({ label: 'E2E Room' })
  await field('Date').fill(date)
  await field('Start time').fill('10:00')
  await field('End time').fill('11:00')
  await admin.getByRole('button', { name: 'Create class' }).click()
  await admin.waitForURL(/\/admin\/schedule$/)
  await adminContext.close()

  const instructorContext = await browser.newContext()
  const instructor = await instructorContext.newPage()
  await signInStaff(instructor, staff.instructor)
  await instructor.waitForURL(/\/instructor\/schedule/)
  await expect(instructor.getByRole('heading', { name: 'My schedule' })).toBeVisible()
  const entry = instructor.getByText(catalogue.portalClassType, { exact: true })
  await expect(entry).toBeVisible()
  await expect(
    instructor.locator('div').filter({ has: entry }).filter({ hasText: /10:00\s*(am)?\s*–/i }).last(),
  ).toBeVisible()
  await instructorContext.close()
})
