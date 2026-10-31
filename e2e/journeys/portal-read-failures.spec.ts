import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test'
import { signInStaff, studio } from '../src/studio'

/**
 * Journeys: the staff portal never draws a failed read as data.
 *
 * Each test makes one API call fail the way the server would (a `500`) and
 * asserts what an admin can see: the screen says what could not be loaded and
 * offers Try again, none of the false things a failure could be drawn as ("No
 * active admins yet", "Nothing has gone quiet", "No members match.", an empty
 * week, no bubble on the bell), and after the read recovers Try again brings
 * the real screen in. One more test fails a read with a `401` and checks that
 * the session ends and the admin is sent to sign in. The pure rules are the
 * unit tests of `failed-read.ts`, `attention.ts` and `location-list.ts`.
 */

/** Fail every GET this page makes to a path ending in `suffix` with `status`, until `stop`. */
async function failRead(
  page: Page,
  suffix: string,
  status = 500,
): Promise<{ stop: () => Promise<void>; served: () => number }> {
  let served = 0
  const matches = (url: URL) => url.pathname.endsWith(suffix)
  const handler = async (route: Route) => {
    const request = route.request()
    if (request.method() !== 'GET') return route.fallback()
    served++
    // The answer carries the CORS headers the API's own would, or the browser
    // would hide it behind a network error.
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': request.headers().origin ?? '*',
        'access-control-expose-headers': 'set-auth-token',
        vary: 'Origin',
      },
      body: JSON.stringify({ error: status === 401 ? 'unauthorized' : 'internal_error', message: 'The server could not answer.' }),
    })
  }
  await page.route(matches, handler)
  return { stop: () => page.unroute(matches, handler), served: () => served }
}

/** Every Try again names what it retries; this finds the one for `what`. */
const tryAgain = (page: Page, what: string) => page.getByRole('button', { name: `Try loading ${what} again` })

const portalUrl = (path: string) => `${studio().urls.portal}${path}`

/**
 * The admin signs in once, for the whole file: the sign-in is rate limited per
 * account ("Too many attempts"), and a sign-in per test would take the minute's
 * allowance from the journeys that run after this file. Each test opens a fresh
 * page with that session's storage, so a route registered before its first page
 * still sees every call, as it would from a sign-in.
 */
let adminSession: Awaited<ReturnType<BrowserContext['storageState']>>

test.beforeAll(async ({ browser }) => {
  const { staff } = studio()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await context.newPage()
    await signInStaff(page, staff.admin)
    await page.waitForURL(/\/admin/)
    adminSession = await context.storageState()
  } finally {
    await context.close()
  }
})

const adminPage = (browser: Browser) =>
  browser.newPage({ viewport: { width: 1280, height: 800 }, storageState: adminSession })

test('ADM-02 when the notification summary cannot be read, the bell says it could not check, the panel offers Try again, and Try again brings the real bell in', async ({
  browser,
}) => {
  const page = await adminPage(browser)
  try {
    const summary = await failRead(page, '/portal/attention/summary')
    const panel = await failRead(page, '/portal/attention')
    await page.goto(portalUrl('/admin'))

    const bell = page.getByTestId('attention-bell')
    await expect(bell).toHaveAttribute('aria-label', /couldn.t check what needs attention/i)
    await expect(page.getByTestId('attention-bubble')).toHaveText('!')
    expect(summary.served(), 'the journey served the 500 to the summary read').toBeGreaterThan(0)

    await bell.click()
    const dialog = page.getByRole('dialog', { name: 'Notifications' })
    await expect(dialog.getByText("Couldn't load notifications.")).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Needs action', exact: true })).toBeVisible()
    await expect(dialog.getByText(/Needs action \(0\)/)).toHaveCount(0)
    expect(panel.served(), 'the journey served the 500 to the panel read').toBeGreaterThan(0)

    await summary.stop()
    await panel.stop()
    await tryAgain(page, 'notifications').click()
    await expect(dialog.getByText("Couldn't load notifications.")).toHaveCount(0)
    await expect(bell).not.toHaveAttribute('aria-label', /couldn.t check/i)
  } finally {
    await page.close()
  }
})

test('ADM-03 when the staff list cannot be read, the Staff page says so with Try again, draws no counts and no "No active admins yet", and Try again brings the staff in', async ({
  browser,
}) => {
  const { staff } = studio()
  const page = await adminPage(browser)
  try {
    const failing = await failRead(page, '/portal/admin/staff')
    await page.goto(portalUrl('/admin/staff'))

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the staff list." })).toBeVisible()
    await expect(tryAgain(page, 'the staff list')).toBeVisible()
    await expect(page.getByText('No active admins yet.')).toHaveCount(0)
    await expect(page.getByText('No active instructors yet.')).toHaveCount(0)
    await expect(page.getByText(/^Active \(/)).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the staff read').toBeGreaterThan(0)

    await failing.stop()
    await tryAgain(page, 'the staff list').click()
    await expect(page.getByText(staff.admin.name, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Couldn't load the staff list.")).toHaveCount(0)
  } finally {
    await page.close()
  }
})

test('ADM-04 when the member search on a class roster fails, it says it could not search and never "No members match.", and Try again searches again', async ({
  browser,
}) => {
  const { classes } = studio()
  const page = await adminPage(browser)
  try {
    await page.goto(portalUrl(`/admin/schedule/class/${classes.staffWaitlist.id}`))
    await page.getByRole('button', { name: 'Add member' }).click()

    const failing = await failRead(page, '/portal/admin/clients')
    await page.getByLabel('Search members').fill('ab')
    await expect(page.getByText("Couldn't search members.")).toBeVisible()
    await expect(page.getByText('No members match.')).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the member search').toBeGreaterThan(0)

    await failing.stop()
    // This line has its own sentence ("Couldn't search members."), so its Try again is named "Try the member search again".
    await page.getByRole('button', { name: 'Try the member search again' }).click()
    await expect(page.getByText("Couldn't search members.")).toHaveCount(0)
  } finally {
    await page.close()
  }
})

test('ADM-05 when the schedule cannot be read, the admin timetable says so with Try again instead of drawing an empty week, and Try again draws the grid', async ({
  browser,
}) => {
  const page = await adminPage(browser)
  try {
    const failing = await failRead(page, '/portal/admin/schedule')
    await page.goto(portalUrl('/admin/schedule'))

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the schedule." })).toBeVisible()
    await expect(page.getByText('Loading schedule…')).toHaveCount(0)
    // The grid's hour labels are not drawn beside the failure.
    await expect(page.getByText('12pm', { exact: true })).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the schedule read').toBeGreaterThan(0)

    await failing.stop()
    await tryAgain(page, 'the schedule').click()
    await expect(page.getByText("Couldn't load the schedule.")).toHaveCount(0)
    await expect(page.getByText('12pm', { exact: true }).first()).toBeVisible()
  } finally {
    await page.close()
  }
})

test('ADM-06 when the partial payments cannot be read, the page says so with Try again and never says "Nothing has gone quiet", and Try again brings the real page in', async ({
  browser,
}) => {
  const page = await adminPage(browser)
  try {
    const failing = await failRead(page, '/portal/admin/purchases/silent')
    await page.goto(portalUrl('/admin/purchases'))

    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the partial payments." })).toBeVisible()
    await expect(page.getByText('Nothing has gone quiet')).toHaveCount(0)
    await expect(page.getByText(/Holding S\$/)).toHaveCount(0)
    expect(failing.served(), 'the journey served the 500 to the partial payments read').toBeGreaterThan(0)

    await failing.stop()
    await tryAgain(page, 'the partial payments').click()
    await expect(page.getByText("Couldn't load the partial payments.")).toHaveCount(0)
    // Either the studio holds partial payments or it has none; both are answers.
    await expect(page.getByText(/Nothing has gone quiet|Holding S\$/).first()).toBeVisible()
  } finally {
    await page.close()
  }
})

test("ADM-07 when the count of Unlimited Plans calling a location home cannot be read, archiving asks the admin, saying it could not check, and declining archives nothing", async ({
  browser,
}) => {
  const page = await adminPage(browser)
  try {
    const failing = await failRead(page, '/live-unlimited-count')
    const asked: string[] = []
    page.on('dialog', dialog => {
      asked.push(dialog.message())
      void dialog.dismiss()
    })
    const archives: string[] = []
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().endsWith('/archive')) archives.push(req.url())
    })

    await page.goto(portalUrl('/admin/locations'))
    await page.getByRole('button', { name: 'Archive', exact: true }).first().click()

    await expect.poll(() => asked.length).toBeGreaterThan(0)
    expect(asked[0]).toMatch(/Couldn.t check whether any live Unlimited Plan calls/)
    expect(asked[0]).toMatch(/Archive anyway\?$/)
    expect(failing.served(), 'the journey served the 500 to the count').toBeGreaterThan(0)
    expect(archives, 'declining sent no archive request').toEqual([])
  } finally {
    await page.close()
  }
})

test('ADM-08 when a portal read is answered 401, the session ends and the admin is sent to sign in, with no "Couldn\'t load" left on screen', async ({
  browser,
}) => {
  const page = await adminPage(browser)
  try {
    await failRead(page, '/portal/admin/staff', 401)
    await page.goto(portalUrl('/admin/staff'))

    await page.waitForURL(/\/login/)
    await expect(page.getByText(/Couldn.t load the staff list/)).toHaveCount(0)
  } finally {
    await page.close()
  }
})
