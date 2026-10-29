import { expect, test, type Page, type Route } from '@playwright/test'
import { openDayOf } from '../src/schedule'
import { signInMember, studio, visitSignedOut } from '../src/studio'

/**
 * Journeys: a failed read is never drawn as data.
 *
 * Each test makes one API call fail the way the server or the network would
 * (a `500`, or a dropped connection) and asserts what the member can see: what
 * did load, a line saying what did not, and none of the false things a failure
 * could be drawn as ("Nothing booked yet.", "No corporate packages on offer
 * right now.", "Not a member yet", the sign-in page). fe-client-features §9.3.
 *
 * The `holder` holds a class, a workshop place, a scheduled private session and
 * a pending corporate request, and nothing here changes any of them.
 */

/** A call that fails for as long as the returned handle is not stopped. */
type Failing = { stop: () => Promise<void> }

/**
 * Fail every call this page makes to a path ending in `suffix`: `server` answers
 * `500`, `dropped` loses the connection. The answer carries the CORS headers the
 * API's own would, or the browser would hide it behind a network error.
 */
async function failRead(page: Page, suffix: string, how: 'server' | 'dropped' = 'server'): Promise<Failing> {
  const matches = (url: URL) => url.pathname.endsWith(suffix)
  const handler = async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fallback()
    if (how === 'dropped') return route.abort('connectionreset')
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
  return { stop: () => page.unroute(matches, handler) }
}

/**
 * Sign a member in with nothing to celebrate over the page. The member app
 * opens a celebration over whatever page it is on for an approved Private
 * session or Corporate Request the member has not seen, and an earlier journey
 * in the same run may leave one on the shared `holder`: its overlay would take
 * every click here. The approvals read is answered with an empty list for this
 * page only; nothing is marked seen on the server, so the journeys that rely
 * on that approval still find it. Call before the first page.
 */
async function signInQuietly(page: Page, member: { token: string }): Promise<void> {
  await page.route(
    url => url.pathname.endsWith('/me/approvals'),
    async route => {
      const request = route.request()
      if (request.method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': request.headers().origin ?? '*',
          'access-control-expose-headers': 'set-auth-token',
          vary: 'Origin',
        },
        body: JSON.stringify({ approvals: [] }),
      })
    },
  )
  await signInMember(page, member)
}

/** One booking's card on My bookings, by the name it leads with. */
function card(page: Page, title: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })
}

function packageCard(page: Page, name: string) {
  return page
    .locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Purchase' }) })
    .last()
}

test('ACC-63 a signed-in member whose session cannot be read is told so, never sent to sign in, and Try again brings their account back', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.holder)
  const visited: string[] = []
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  const session = await failRead(page, '/auth/client/get-session')
  await page.goto(`${urls.client}/account`)
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign up' })).toHaveCount(0)
  expect(page.url()).not.toContain('/login')

  // The backend answers again: one tap, and the member is where they were.
  await session.stop()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('region', { name: 'Up next' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  expect(page.url()).toBe(`${urls.client}/account`)
  expect(visited.filter(url => url.includes('/login'))).toEqual([])
})

test('ACC-63 an anonymous visitor whose session read fails still sees the signed-out timetable', async ({ page }) => {
  const { urls, catalogue } = studio()
  await visitSignedOut(page)
  await failRead(page, '/auth/client/get-session')

  await page.goto(urls.client)
  await openDayOf(page, catalogue.buyClassType)
  await expect(page.getByRole('heading', { name: catalogue.buyClassType, exact: true }).locator('visible=true').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
})

test('ACC-64 My bookings lists what loaded and names the private sessions that did not, on every filter', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/me/pt-sessions')

  await page.goto(`${urls.client}/account/bookings`)
  await expect(card(page, catalogue.myBookingsClassType)).toBeVisible()
  await expect(card(page, catalogue.workshopName)).toBeVisible()
  await expect(page.getByText("Couldn't load your private sessions.")).toBeVisible()
  await expect(card(page, '1-on-1 · Any class type')).toHaveCount(0)
  // No count states how many there are while part of them is missing.
  await expect(page.getByRole('tab', { name: /^Upcoming\s*\d/ })).toHaveCount(0)

  // The Private filter says what failed, not that there is nothing.
  await page.getByRole('tab', { name: 'Private' }).click()
  await expect(page.getByText("Couldn't load your private sessions.")).toBeVisible()
  await expect(page.getByText('No upcoming private sessions')).toHaveCount(0)
  await expect(page.getByText('Request a session')).toHaveCount(0)
})

test('ACC-64 My bookings names the waitlist when that read fails, and still lists the rest', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/me/waitlist')

  await page.goto(`${urls.client}/account/bookings`)
  await expect(card(page, catalogue.myBookingsClassType)).toBeVisible()
  await expect(card(page, '1-on-1 · Any class type')).toBeVisible()
  await expect(page.getByText("Couldn't load your waitlist.")).toBeVisible()
})

test('ACC-64 a failed read is retried from the line, without leaving the page', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)
  const pt = await failRead(page, '/me/pt-sessions')

  await page.goto(`${urls.client}/account/bookings`)
  await expect(page.getByText("Couldn't load your private sessions.")).toBeVisible()
  await pt.stop()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(card(page, '1-on-1 · Any class type')).toBeVisible()
  await expect(page.getByText("Couldn't load your private sessions.")).toHaveCount(0)
  await expect(card(page, catalogue.myBookingsClassType)).toBeVisible()
})

test('ACC-65 Up next never says nothing is booked while a read failed, and says it may not be the next booking', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/me/workshop-bookings')
  await failRead(page, '/me/pt-sessions')
  await failRead(page, '/me/bookings/past', 'dropped')

  await page.goto(`${urls.client}/account`)
  const upNext = page.getByRole('region', { name: 'Up next' })
  await expect(upNext.getByText(catalogue.myBookingsClassType, { exact: true })).toBeVisible()
  await expect(upNext.getByText(/may not be your next/)).toBeVisible()
  await expect(page.getByText('Nothing booked yet.')).toHaveCount(0)

  // The ticket above the timetable carries the same note.
  await page.goto(urls.client)
  await expect(page.getByText(/may not be your next/)).toBeVisible()
})

test('ACC-65 Up next with nothing to draw and a read that failed says it could not load what is next', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  await failRead(page, '/me/workshop-bookings')
  await failRead(page, '/me/pt-sessions')
  await failRead(page, '/me/bookings/past', 'dropped')

  await page.goto(`${urls.client}/account`)
  const upNext = page.getByRole('region', { name: 'Up next' })
  await expect(upNext.getByText("Couldn't load what's next.")).toBeVisible()
  await expect(upNext.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('Nothing booked yet.')).toHaveCount(0)
})

test('PKG-51 the Corporate tab says it could not load the corporate packages, not that none are on offer', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/me/corporate-packages')

  await page.goto(`${urls.client}/packages#corporate`)
  await expect(page.getByText("Couldn't load corporate packages")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('No corporate packages on offer right now.')).toHaveCount(0)
})

test('PAY-75 a checkout whose options could not be read says it could not check Part Payment, offers none, and still takes the whole Balance', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/me/checkout/options')

  await page.goto(`${urls.client}/packages`)
  await packageCard(page, catalogue.packageName).getByRole('button', { name: 'Purchase' }).click()
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  await expect(page.getByText(/couldn't check whether this payment can be split/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Partial payment/ })).toHaveCount(0)
  // Paying the whole Balance stays available. Nothing is paid here.
  await expect(page.getByRole('button', { name: /^Pay \S*\$[\d,.]+$/ })).toBeVisible()
})

test('PT-168 a partner lookup that failed says so, and the request cannot be sent until a lookup answers', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.holder)
  // The holder holds a 1-on-1 package only; a 2-on-1 beside it is what puts
  // the partner form on the page, so it is added to what the page reads.
  await page.route(
    url => url.pathname.endsWith('/me/packages'),
    async route => {
      const response = await route.fetch()
      const body = await response.json()
      const oneOnOne = body.client_packages.find((p: { kind: string }) => p.kind === 'pt')
      body.client_packages.push({
        ...oneOnOne,
        id: '00000000-0000-4000-8000-0000000000a1',
        session_type: '2on1',
        credits_or_sessions_remaining: 4,
      })
      body.entitlements.pt_2on1_remaining = 4
      await route.fulfill({ response, json: body })
    },
  )
  await failRead(page, '/me/pt-sessions/partner-lookup')
  const sent: string[] = []
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/me/pt-sessions/request')) sent.push(req.url())
  })

  await page.goto(`${urls.client}/private-sessions`)
  await page.getByRole('button', { name: '2-on-1', exact: true }).click()
  // A slot the form accepts, so the partner check is the only thing that can
  // stop the request. The window notice is up once the studio's window has been
  // read, and its earliest day is the date picker's `min`. The notice is known by
  // what it always carries, whatever its wording: a count of days and the dates
  // it allows in brackets, "Choose dates 3 to 7 days from today (Sun 1 Nov – Thu 5 Nov)."
  await expect(page.getByText(/^(Book|Choose) .*\d+ days?.* \([A-Z][a-z]{2} \d+ [A-Z][a-z]{2}[^)]*\)\.$/)).toBeVisible()
  const date = page.getByLabel('Date', { exact: true })
  const earliest = await date.getAttribute('min')
  expect(earliest).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await date.fill(earliest!)
  await page.getByLabel('Partner email').fill('someone@example.com')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByText("Couldn't check that email.")).toBeVisible()
  await expect(page.getByText(/Not a member yet/)).toHaveCount(0)

  await page.getByRole('button', { name: /^Send request/ }).click()
  await expect(page.getByText("Check your partner's email again.")).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(sent).toEqual([])
})

test('PT-169 the private session request page shows the error page when the studio booking window could not be read', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.holder)
  await failRead(page, '/public/pt-booking-config')

  await page.goto(`${urls.client}/private-sessions`)
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Send request/ })).toHaveCount(0)
})

test('WSP-38 a workshop link that is not a workshop reads Workshop not found with a way back, and a real one still opens', async ({ page }) => {
  const { urls, catalogue, members } = studio()
  await signInQuietly(page, members.holder)

  for (const id of ['3f1d2c4e-7a5b-4c8d-9e0f-1a2b3c4d5e6f', 'not-a-uuid']) {
    await page.goto(`${urls.client}/workshops/${id}`)
    await expect(page.getByText('Workshop not found')).toBeVisible()
    await expect(page.getByRole('link', { name: 'All workshops' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
  }

  await page.goto(`${urls.client}/workshops`)
  await page.getByRole('link', { name: new RegExp(catalogue.workshopName) }).first().click()
  await expect(page).toHaveURL(/\/workshops\/[^/]+$/)
  await expect(page.getByRole('heading', { name: catalogue.workshopName, exact: true }).first()).toBeVisible()
  await expect(page.getByText('Workshop not found')).toHaveCount(0)
})
