import { expect, test, type APIRequestContext } from '@playwright/test'
import { signInStaff, studio } from '../src/studio'

/**
 * Journey: when the portal cannot read the studio's locations in full, an admin
 * is not offered an edit that would blank a location's phone and Maps link (#496).
 *
 * The staff payload names a location but carries neither its phone nor its Maps
 * link; the full read (`/portal/admin/locations`) does. The portal used to fall
 * back to the payload's rows when the full read failed, so a renamed location was
 * saved with both fields empty. The journey fails that read, opens Manage
 * locations, and checks it says so and offers no edit; the read then succeeds on
 * Retry, editing works, and the location's phone and Maps link, read back from the
 * backend, are the ones it started with.
 *
 * The location is the studio's own, shared with the other journeys: it is given a
 * phone and a Maps link first, and its name, phone and Maps link are put back at
 * the end.
 */
test('LOC-20 when the admin locations read fails, Manage locations says so and offers no edit; after Retry an edit saves and the location keeps its phone and Maps link', async ({
  browser,
  request,
}) => {
  const { slug, urls, staff, site } = studio()
  const phone = '+6561234567'
  const gmapsUrl = 'https://maps.app.goo.gl/loc496'

  // The admin's own session, for setting up and reading back, as setStudioFlag does.
  const headers = { Origin: urls.portal, 'X-Tenant-Slug': slug }
  const signedIn = await request.post(`${urls.api}/auth/staff/sign-in/email`, {
    headers,
    data: { email: staff.admin.email, password: staff.password },
  })
  expect(signedIn.ok(), `admin sign-in: ${signedIn.status()}`).toBe(true)
  const token = signedIn.headers()['set-auth-token']
  expect(token, 'admin sign-in returned a session token').toBeTruthy()
  const asAdmin = { ...headers, Authorization: `Bearer ${token}` }

  type Row = { id: string; name: string; phone: string | null; gmaps_url: string | null }
  const readLocation = async (): Promise<Row> => {
    const res = await request.get(`${urls.api}/portal/admin/locations?include_archived=true`, { headers: asAdmin })
    expect(res.ok(), `locations: ${res.status()}`).toBe(true)
    const { locations } = (await res.json()) as { locations: Row[] }
    const found = locations.find(l => l.name === site.locationName || l.name.startsWith(`${site.locationName} `))
    expect(found, 'the studio has its location').toBeTruthy()
    return found!
  }
  const patch = async (id: string, data: Record<string, unknown>) => {
    const res = await request.patch(`${urls.api}/portal/admin/locations/${id}`, { headers: asAdmin, data })
    expect(res.ok(), `patch: ${res.status()} ${await res.text()}`).toBe(true)
  }

  // What the shared location held before the journey, put back in `finally`.
  const location = await readLocation()
  const original = { name: location.name, phone: location.phone, gmaps_url: location.gmaps_url }
  await patch(location.id, { name: site.locationName, phone, gmaps_url: gmapsUrl })

  // The portal calls `${urls.api}/portal/admin/locations`; match on the path that
  // URL really has (it carries the API's `/api/v1` prefix), not a bare `/portal/...`.
  const locationsPath = new URL(`${urls.api}/portal/admin/locations`).pathname

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    // The portal's full locations read fails until the journey lets it through.
    let failing = true
    let failedReads = 0
    await page.route(`${urls.api}/portal/admin/locations**`, route => {
      const url = new URL(route.request().url())
      const isFullRead =
        route.request().method() === 'GET' &&
        url.pathname === locationsPath &&
        url.searchParams.get('include_archived') === 'true'
      if (failing && isFullRead) {
        failedReads++
        return route.fulfill({ status: 500, json: { error: 'internal_error' } })
      }
      return route.fallback()
    })
    const updates: string[] = []
    page.on('request', req => {
      if (req.method() === 'PATCH' && new URL(req.url()).pathname.startsWith(`${locationsPath}/`)) {
        updates.push(req.url())
      }
    })

    await signInStaff(page, staff.admin)
    await page.waitForURL(/\/admin/)

    // The switcher still names the location: choosing a workspace needs only names.
    await page.getByRole('button', { name: new RegExp(site.locationName) }).first().click()
    // The trigger and the one list entry both carry the name.
    await expect(page.getByRole('button', { name: site.locationName, exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Manage locations' }).click()

    const manage = page.getByRole('dialog').filter({ hasText: 'Manage locations' })
    await expect(manage.getByRole('alert')).toContainText(/could not be loaded/i)
    await expect(manage.getByRole('button', { name: 'Retry' })).toBeVisible()
    // Add stays; nothing that changes an existing location is offered.
    await expect(manage.getByRole('button', { name: 'Add location' })).toBeVisible()
    await expect(manage.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(manage.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
    await expect(manage.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0)
    expect(failedReads, 'the journey served the 500 to the full read').toBeGreaterThan(0)
    expect(updates, 'no update request left the browser').toEqual([])

    // The read recovers; Retry brings the full list in and editing works.
    failing = false
    await manage.getByRole('button', { name: 'Retry' }).click()
    await expect(manage.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible()
    await expect(manage.getByRole('alert')).toHaveCount(0)

    const renamed = `${site.locationName} (renamed)`
    await manage.getByRole('button', { name: 'Edit', exact: true }).first().click()
    const form = page.getByRole('dialog').filter({ hasText: 'Edit location' })
    await expect(form.getByLabel('Phone number')).toHaveValue(phone)
    await expect(form.getByLabel('Google Maps link')).toHaveValue(gmapsUrl)
    await form.getByLabel('Name').fill(renamed)
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(form).toBeHidden()
    await expect(manage.getByText(renamed)).toBeVisible()

    // What the backend holds: renamed, with the phone and Maps link as they were.
    const after = await readLocation()
    expect(after.name).toBe(renamed)
    expect(after.phone).toBe(phone)
    expect(after.gmaps_url).toBe(gmapsUrl)
  } finally {
    await patch(location.id, original)
    await page.close()
  }
})
