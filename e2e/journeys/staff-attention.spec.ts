import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { signInStaff, studio, studioTimezone } from '../src/studio'

/**
 * Journey: the bell tells an admin what is waiting, and the click lands on it.
 *
 * A member asks for a private session. The admin signs in and the bell already
 * counts it, the panel opens by itself with the request in a sentence, and
 * clicking it lands on PT Requests with that request's drawer open. Scheduling
 * it takes it off the admin's list, and the bubble is one lower. The studio is
 * shared with the other journeys, so the journey follows its own request rather
 * than a hard-coded number.
 *
 * The member's request is sent as the member app sends it (the request form's
 * own call, signed in as the studio's holder); the journey is about what the
 * admin sees, and the form has its own coverage.
 */
test('ATN-16 a member requests a private session, the admin sees the bell and the panel, opens the request from it and schedules it, and the bell empties', async ({
  browser,
  request,
}) => {
  const { slug, urls, catalogue, members, staff } = studio()
  const address = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
  const asMember = {
    Origin: urls.client,
    'X-Tenant-Slug': slug,
    'X-Forwarded-For': address,
    Authorization: `Bearer ${members.holder.token}`,
  }
  const read = async <T>(path: string) => {
    const res = await request.get(`${urls.api}${path}`, { headers: asMember })
    expect(res.ok(), `${path}: ${res.status()}`).toBe(true)
    return (await res.json()) as T
  }

  // The member's request, on the PT package the studio gave them.
  const profile = await read<{ name: string }>('/me')
  const { client_packages: packages } = await read<{
    client_packages: Array<{ id: string; package_name: string }>
  }>('/me/packages')
  const pt = packages.find(p => p.package_name === catalogue.ptPackageName)
  expect(pt, 'the holder has a PT package').toBeTruthy()
  const window = await read<{ min_book_in_advance_days: number; book_in_advance_days: number }>(
    '/public/pt-booking-config',
  )
  const { locations } = await read<{ locations: Array<{ id: string }> }>('/public/locations')
  // The slot is half a day off the hour the studio was set up at: its classes,
  // its workshop day and the holder's session all sit within a few hours after
  // that hour, in the room the admin schedules into, so a fixed 09:00 lands on
  // the workshop when the setup ran late in the UTC day. Twelve hours back from
  // `aheadDays` on, it falls on the studio's day `aheadDays` or the one before,
  // both inside the Book in advance window.
  const aheadDays = Math.min(Math.max(window.min_book_in_advance_days + 1, 7), window.book_in_advance_days)
  const slotAt = new Date(Date.now() + aheadDays * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000)
  const onStudioClock = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: await studioTimezone(request),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(slotAt)
      .map(part => [part.type, part.value]),
  )
  const proposedDate = `${onStudioClock.year}-${onStudioClock.month}-${onStudioClock.day}`
  const requested = await request.post(`${urls.api}/me/pt-sessions/request`, {
    headers: asMember,
    data: {
      locationId: locations[0]!.id,
      sessionType: '1on1',
      clientPackageId: pt!.id,
      slots: [{ proposedDate, startTime: `${onStudioClock.hour}:00` }],
    },
  })
  expect(requested.status(), await requested.text()).toBe(201)

  // The admin signs in: the bell already counts it, and the panel is open.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await signInStaff(page, staff.admin)
  await page.waitForURL(/\/admin/)
  const bell = page.getByTestId('attention-bell')
  const panel = page.getByTestId('attention-panel')
  await expect(panel).toBeVisible()
  const item = panel.getByRole('link', { name: new RegExp(`${profile.name} asked for a 1-on-1 session`) })
  await expect(item).toBeVisible()
  // The studio is shared with the other journeys, so the bell may already count
  // things they left (a member's team-session request, say): the journey follows its own
  // request, not a number. The bubble reads what the bell says, and the bell
  // counts the request: it is at least 1, and one lower once it is scheduled.
  const countOf = async () => {
    const label = (await bell.getAttribute('aria-label')) ?? ''
    return Number(/^Notifications, (\d+) need attention$/.exec(label)?.[1] ?? 0)
  }
  const counted = await countOf()
  expect(counted, 'the bell counts the request').toBeGreaterThanOrEqual(1)
  if (counted <= 99) await expect(page.getByTestId('attention-bubble')).toHaveText(String(counted))

  // Clicking it closes the panel and opens PT Requests on that request.
  await item.click()
  await expect(panel).toBeHidden()
  await page.waitForURL(/\/admin\/pt-requests/)
  await expect(page.getByRole('heading', { name: profile.name, level: 2 })).toBeVisible()
  await expect(page.getByText('Proposed slots')).toBeVisible()

  // Scheduling it takes it off the list. The dialog starts on the member's
  // proposed time; the admin picks who teaches and where.
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const selects = dialog.locator('select')
  await selects.nth(0).selectOption({ index: 1 })
  await selects.nth(1).selectOption({ index: 1 })
  await expect(selects.nth(2)).toBeEnabled()
  await selects.nth(2).selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Schedule session' }).click()
  await expect(dialog).toBeHidden()

  // The page asks for the count again as soon as it has scheduled: the bubble
  // is one lower (gone, if the request was all there was), and the request has
  // left the panel.
  const remaining = counted - 1
  await expect(bell).toHaveAttribute('aria-label', remaining > 0 ? `Notifications, ${remaining} need attention` : 'Notifications')
  if (remaining === 0) await expect(page.getByTestId('attention-bubble')).toHaveCount(0)
  await bell.click()
  const reopened = page.getByTestId('attention-panel')
  await expect(reopened).toBeVisible()
  await expect(reopened.getByRole('link', { name: new RegExp(`${profile.name} asked for a 1-on-1 session`) })).toHaveCount(0)
  if (remaining === 0) await expect(reopened.getByText('Nothing needs your attention')).toBeVisible()
})
