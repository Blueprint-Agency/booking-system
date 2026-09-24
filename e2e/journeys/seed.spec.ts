import { expect, test } from '@playwright/test'
import { studio } from '../src/studio'

/**
 * The Playwright agents' seed (#207) — where a planner or generator session
 * starts. It runs, and must pass, wherever the agents work: the local stack,
 * pull requests included. The staging gate leaves it out (playwright.config.ts).
 *
 * The studio itself is made by global setup, the one fixture every journey
 * uses: a disposable `e2e-…` studio with its own staff, members, plan and
 * classes (be/src/e2e/studio.ts). This opens its member app, and — off CI —
 * prints what an agent needs to explore it, since every one of those values is
 * new each run. Journeys read them from `studio()`; a literal slug, address or
 * password copied from here into a journey fails the next run.
 */
test('seed: the run’s disposable studio is open, with a class to book', async ({ page }) => {
  const s = studio()
  if (!process.env.CI) {
    console.log(
      [
        `[seed] member app  ${s.urls.client}  (signed out; members are signed in with signInMember)`,
        `[seed] staff portal ${s.urls.portal}/login`,
        `[seed]   admin      ${s.staff.admin.email}`,
        `[seed]   instructor ${s.staff.instructor.email}`,
        `[seed]   password   ${s.staff.password}`,
      ].join('\n'),
    )
  }

  await page.goto(s.urls.client)
  await expect(page.getByRole('heading', { name: s.catalogue.buyClassType, exact: true }).first()).toBeVisible()
})
