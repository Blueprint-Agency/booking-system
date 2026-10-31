import { expect, test } from '@playwright/test'
import { openDayOf } from '../src/schedule'
import { studio, studioTimezone } from '../src/studio'

/**
 * Journey: a member's schedule is on the studio's clock, not the phone's.
 *
 * The browser here is in Newfoundland, UTC-3:30 or -2:30: its hour differs from
 * the studio's by whole hours plus a half, so the class's time reads differently
 * on the phone's clock even by its minutes, and the day can differ too. The row
 * must read the studio's hour and date, which is what the member walks in for.
 *
 * The studio's zone is read from the same slug lookup the member app uses, so
 * the journey holds for a studio in any zone the phone's is not.
 */
const PHONE_ZONE = 'America/St_Johns'

test.use({ timezoneId: PHONE_ZONE })

const label = (zone: string, startsAt: string) => {
  const start = new Date(startsAt)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const day = new Intl.DateTimeFormat('en-SG', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' })
  const time = new Intl.DateTimeFormat('en-SG', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day.format(start)} ${time.format(start)} – ${time.format(end)}`
}

test('TEN-102 a class on the schedule reads the studio\'s date and hour whatever zone the phone is in', async ({ page, request }) => {
  const { urls, catalogue, classes } = studio()
  const studioZone = await studioTimezone(request)
  expect(studioZone).not.toBe(PHONE_ZONE)
  expect(label(studioZone, classes.buy.startsAt)).not.toBe(label(PHONE_ZONE, classes.buy.startsAt))

  await page.goto(urls.client)
  await openDayOf(page, catalogue.buyClassType)

  // The row's own button names the class with its date and times.
  const details = (zone: string) =>
    page.getByRole('button', { name: `Details: ${catalogue.buyClassType}, ${label(zone, classes.buy.startsAt)}` })
  await expect(details(studioZone).locator('visible=true')).toBeVisible()
  await expect(details(PHONE_ZONE)).toHaveCount(0)
})
