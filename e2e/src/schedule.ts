import { expect, type Page } from '@playwright/test'

/**
 * Open the day on the member schedule that holds `className`, as a member does.
 *
 * The schedule shows its days one open at a time, the soonest day with classes
 * open to begin with (fe-client-features.md), so a class on any later day sits
 * in a closed day until its header is tapped. A closed day's rows are still in
 * the page, sliding shut, and Playwright finds them; clicking one only hits the
 * headers stacked over it. A day already open is left open: tapping the open
 * day's header would close it.
 */
export async function openDayOf(page: Page, className: string): Promise<void> {
  const day = page
    .locator('section:has(> h2 > button[aria-controls^="day-"])')
    .filter({ has: page.getByRole('heading', { name: className, exact: true }) })
    .last()
  const header = day.locator(':scope > h2 > button')
  // Retried: a tap before the page has hydrated opens nothing.
  await expect(async () => {
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
  }).toPass()
}
