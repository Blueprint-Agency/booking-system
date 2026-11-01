import { expect, test } from '@playwright/test'
import { openDayOf } from '../src/schedule'
import { signInMember, signInStaff, studio, studioTimezone } from '../src/studio'

/**
 * Journey 2: an admin creates a class, and the instructor and a member read it
 * at the time the admin typed.
 *
 * The studio is in one zone (the e2e studio, Australia/Sydney) and the browser in
 * a third (Los Angeles): the time typed in the portal is a wall time at the
 * studio, and the instructor's schedule and the member's timetable show that same
 * time, not the one the browser's clock would give. A fixed Singapore offset, the
 * browser's zone or UTC anywhere in the path would show here.
 *
 * The class type is one nothing
 * else in the studio is scheduled under, so the instructor can only be seeing
 * the class this journey made. The people use separate browser contexts,
 * as people on separate machines would.
 */
const BROWSER_ZONE = 'America/Los_Angeles'

test.use({ timezoneId: BROWSER_ZONE })

const DAY = 24 * 60 * 60 * 1000

// The member's row names the class with its date and times, as the member app words them.
const memberLabel = (date: string) => {
  const day = new Intl.DateTimeFormat('en-SG', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  return `${day.format(new Date(`${date}T12:00:00Z`))} 10:00 am – 11:00 am`
}

test('TEN-137 an admin creates a class at 10:00, and the instructor and a member read it at 10:00 on the studio\'s clock, whatever zone the browser is in', async ({
  browser,
  request,
}) => {
  const { urls, staff, members, catalogue } = studio()
  const studioZone = await studioTimezone(request)
  expect(studioZone, 'the e2e studio and the browser are in different zones').not.toBe(BROWSER_ZONE)
  // Eight days out on the studio's calendar: past every class the e2e studio
  // seeds into E2E Room (up to day 7, on the hour), so the room is free at 10:00
  // whatever time the run starts, and inside the member timetable's ten days.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: studioZone }).format(new Date(Date.now() + 8 * DAY)) // YYYY-MM-DD

  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInStaff(admin, staff.admin)
  await admin.waitForURL(/\/admin/)

  await admin.goto(`${urls.portal}/admin/schedule/new/class`)
  await expect(admin.getByRole('heading', { name: 'New class' })).toBeVisible()
  const field = (label: string) => admin.getByLabel(label, { exact: true })
  await field('Class type').selectOption({ label: catalogue.portalClassType })
  await field('Main instructor').selectOption({ label: staff.instructor.name })
  await field('Main instructor pay (S$) · optional').fill('50')
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
    instructor.locator('div').filter({ has: entry }).filter({ hasText: /10:00\s*am\s*–\s*11:00\s*am/i }).last(),
  ).toBeVisible()
  await instructorContext.close()

  // The member's timetable reads the same studio hour, on the studio's day.
  const memberContext = await browser.newContext()
  const member = await memberContext.newPage()
  await signInMember(member, members.waiter)
  await member.goto(urls.client)
  await openDayOf(member, catalogue.portalClassType)
  await expect(
    member
      .getByRole('button', { name: `Details: ${catalogue.portalClassType}, ${memberLabel(date)}` })
      .locator('visible=true'),
  ).toBeVisible()
  await memberContext.close()
})
