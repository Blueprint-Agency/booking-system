import { expect, test, type Page } from '@playwright/test'
import { openDayOf } from '../src/schedule'
import { signInMember, studio, visitSignedOut } from '../src/studio'

/**
 * Journeys: the frame every member page sits in — the top bar —
 * and what the schedule shows of cost (fe-client-features §3.1, §9).
 */

/** Any money amount: "$10", "S$10.00". */
const MONEY = /\$\s?\d/

test('CAT-05 the class schedule shows each class its credit cost and never a money price, signed out or in', async ({ browser }) => {
  const { urls, catalogue, members } = studio()
  for (const who of ['visitor', 'member'] as const) {
    const context = await browser.newContext()
    const page = await context.newPage()
    if (who === 'member') await signInMember(page, members.canceller)
    else await visitSignedOut(page)

    await page.goto(urls.client)
    await openDayOf(page, catalogue.buyClassType)
    const row = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: catalogue.buyClassType, exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Book Now|Booked/ }) })
      .last()
    await expect(row.getByText('1 credit', { exact: true }).locator('visible=true').first()).toBeVisible()
    await expect(page.getByRole('main')).not.toContainText(MONEY)

    // Nor in the class's own detail.
    await page.getByRole('button', { name: `Details: ${catalogue.buyClassType},` }).locator('visible=true').click()
    const detail = page.getByRole('dialog', { name: catalogue.buyClassType, exact: true })
    await expect(detail.getByText(/1 credit/).first()).toBeVisible()
    await expect(detail).not.toContainText(MONEY)
    await context.close()
  }
})

test('ACC-09 a signed-in member sees their avatar to their account in the top bar, not Log in, and no credit balance', async ({ browser }) => {
  const { urls, members } = studio()

  const visitorContext = await browser.newContext()
  const visitor = await visitorContext.newPage()
  await visitSignedOut(visitor)
  await visitor.goto(urls.client)
  await expect(topBar(visitor).getByRole('link', { name: 'Log in' })).toBeVisible()
  await expect(topBar(visitor).getByRole('link', { name: 'Sign up' })).toBeVisible()
  await visitorContext.close()

  const memberContext = await browser.newContext()
  const member = await memberContext.newPage()
  // The canceller holds the plan, so a balance would have something to show.
  await signInMember(member, members.canceller)
  await member.goto(urls.client)
  const avatar = topBar(member).getByRole('link', { name: 'Account' })
  await expect(avatar).toHaveAttribute('href', '/account')
  await expect(avatar).toHaveText('EC')
  await expect(topBar(member).getByRole('link', { name: 'Log in' })).toHaveCount(0)
  await expect(topBar(member).getByRole('link', { name: 'Sign up' })).toHaveCount(0)
  await expect(topBar(member)).not.toContainText(/credit/i)
  await avatar.click()
  await expect(member).toHaveURL(`${urls.client}/account`)
  await memberContext.close()
})

function topBar(page: Page) {
  return page.getByRole('banner')
}
