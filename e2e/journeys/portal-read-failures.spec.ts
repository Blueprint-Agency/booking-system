import { expect, test, type Page, type Route } from '@playwright/test'
import { signInStaff, studio } from '../src/studio'

/**
 * Journeys: the staff portal never draws a failed read as data.
 *
 * Each test makes one API call fail the way the server would (a `500`) and
 * asserts what an admin can see: the screen says what could not be loaded and
 * offers Try again, none of the false things a failure could be drawn as ("No
 * active admins yet", "Nothing has gone quiet", a count of 0, an empty week),
 * and after the read recovers Try again brings the real screen in. The
 * pure rules are the unit tests of `failed-read.ts`.
 */

/** Fail every call this page makes to a path ending in `suffix` with a `500`, until `stop`. */
async function failRead(page: Page, suffix: string): Promise<{ stop: () => Promise<void>; served: () => number }> {
  let served = 0
  const matches = (url: URL) => url.pathname.endsWith(suffix)
  const handler = async (route: Route) => {
    const request = route.request()
    if (request.method() !== 'GET') return route.fallback()
    served++
    // The answer carries the CORS headers the API's own would, or the browser
    // would hide it behind a network error.
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': request.headers().origin ?? '*',
        'access-control-expose-headers': 'set-auth-token',
        vary: 'Origin',
      },
      body: JSON.stringify({ error: 'internal_error', message: 'The server could not answer.' }),
    })
  }
  await page.route(matches, handler)
  return { stop: () => page.unroute(matches, handler), served: () => served }
}

test('ADM-03 when the staff list cannot be read, the Staff page says so with Try again, draws no counts and no "No active admins yet", and Try again brings the staff in', async ({
  browser,
}) => {
  const { staff } = studio()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    const failing = await failRead(page, '/portal/admin/staff')
    await signInStaff(page, staff.admin)
    await page.waitForURL(/\/admin/)
    await page.goto(new URL('/admin/staff', page.url()).toString())

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the staff list." })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByText('No active admins yet.')).toHaveCount(0)
    await expect(page.getByText('No active instructors yet.')).toHaveCount(0)
    await expect(page.getByText(/^Active \(/)).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the staff read').toBeGreaterThan(0)

    await failing.stop()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText(staff.admin.name, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Couldn't load the staff list.")).toHaveCount(0)
  } finally {
    await page.close()
  }
})

test('ADM-06 when the partial payments cannot be read, the page says so with Try again and never says "Nothing has gone quiet", and Try again brings the real page in', async ({
  browser,
}) => {
  const { staff } = studio()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    const failing = await failRead(page, '/portal/admin/purchases/silent')
    await signInStaff(page, staff.admin)
    await page.waitForURL(/\/admin/)
    await page.goto(new URL('/admin/purchases', page.url()).toString())

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the partial payments." })).toBeVisible()
    await expect(page.getByText('Nothing has gone quiet')).toHaveCount(0)
    await expect(page.getByText(/Holding S\$/)).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the partial payments read').toBeGreaterThan(0)

    await failing.stop()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText("Couldn't load the partial payments.")).toHaveCount(0)
    // Either the studio holds partial payments or it has none; both are answers.
    await expect(page.getByText(/Nothing has gone quiet|Holding S\$/).first()).toBeVisible()
  } finally {
    await page.close()
  }
})

test('ADM-05 when the schedule cannot be read, the admin timetable says so with Try again instead of drawing an empty week', async ({
  browser,
}) => {
  const { staff } = studio()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    const failing = await failRead(page, '/portal/admin/schedule')
    await signInStaff(page, staff.admin)
    await page.waitForURL(/\/admin/)
    await page.goto(new URL('/admin/schedule', page.url()).toString())

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the schedule." })).toBeVisible()
    await expect(page.getByText('Loading schedule…')).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the schedule read').toBeGreaterThan(0)

    await failing.stop()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText("Couldn't load the schedule.")).toHaveCount(0)
  } finally {
    await page.close()
  }
})
