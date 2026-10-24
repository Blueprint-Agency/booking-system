/**
 * features/tenant-isolation.md: a member of studio A, and studio A's pages,
 * reaching for studio B (docs/md/spec-tenant-resolution.md). Needs a second
 * studio first:
 *
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs studio
 *   node .claude/skills/verify-booking-system/scripts/drive.mjs .claude/skills/verify-booking-system/drives/tenant-isolation.mjs
 */
export default async ({ page, studio: a, loadStudio, step, shot, aria, save, expect }) => {
  const b = loadStudio(2)
  const member = a.members.canceller
  const api = a.urls.api // already ends in /api/v1
  const call = async (name, path, { slug, origin, token }) => {
    const res = await page.request.get(`${api}${path}`, {
      headers: { 'x-tenant-slug': slug, origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
    const body = await res.text()
    save(`api-${name}.json`, { request: { path, slug, origin, token: token ? 'studio A member' : null }, status: res.status(), body })
    return { status: res.status(), body }
  }

  step(`studio A ${a.slug}, studio B ${b.slug}; member ${member.email} belongs to A`)

  step('baseline: the member reads their own account at studio A')
  const own = await call('own-studio', '/me', { slug: a.slug, origin: a.urls.client, token: member.token })
  expect(own.status).toBe(200)

  step("A's session at B: 401 invalid_token (the session is not even visible at B)")
  const atB = await call('session-at-other-studio', '/me', { slug: b.slug, origin: b.urls.client, token: member.token })
  expect(atB.status).toBe(401)
  expect(atB.body).toContain('invalid_token')

  step("header names B, origin is A's page: 403 tenant_mismatch")
  const mismatch = await call('header-origin-mismatch', '/me', { slug: b.slug, origin: a.urls.client, token: member.token })
  expect(mismatch.status).toBe(403)
  expect(mismatch.body).toContain('tenant_mismatch')

  step("B's class id asked for through studio A: not served")
  const foreignClass = await call('other-studios-class', `/public/classes/${b.classes.buy.id}`, { slug: a.slug, origin: a.urls.client })
  expect(foreignClass.status).toBe(404)
  expect(foreignClass.body).not.toContain(b.catalogue.buyClassType)

  step("in the browser: A's token placed on B's member app is not a session there")
  await page.addInitScript(([origin, token]) => {
    if (window.location.origin === origin) window.localStorage.setItem('rt.client.session', token)
  }, [b.urls.client, member.token])
  await page.goto(`${b.urls.client}/account`)
  await expect(page.getByText(b.site.name).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(member.email)).toHaveCount(0)
  await shot('b-account-with-a-token')
  await aria('b-account-with-a-token')
}
