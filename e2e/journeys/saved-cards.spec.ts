import { expect, test, type Page, type Route } from '@playwright/test'
import { signInMember, studio } from '../src/studio'

/**
 * Journeys: the member's Saved cards, on Profile & security
 * (fe-client-features §8.2).
 *
 * The e2e studio's payment provider is a stub that holds no cards, so the two
 * `/me/cards` calls are answered here, the way the backend answers them:
 * `GET` lists `{ cards }` and `DELETE /me/cards/:id` answers `{ removed: true }`.
 * What is checked is what the member sees and which calls the page makes.
 */

const visa = { id: 'pm_e2e_visa', brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2099 }
const amex = { id: 'pm_e2e_amex', brand: 'amex', last4: '0005', exp_month: 11, exp_year: 2098 }

type Card = typeof visa

/** The headers the API's own answer carries, or the browser hides it behind a network error. */
function cors(route: Route) {
  return {
    'access-control-allow-origin': route.request().headers().origin ?? '*',
    'access-control-expose-headers': 'set-auth-token',
    vary: 'Origin',
  }
}

/**
 * Answer `/me/cards` from a list the test controls. `failList` makes the read
 * answer `500` while true, `failRemove` makes a removal answer `500`. Removals
 * that succeed leave the list, as the provider detaching them would.
 */
async function cardsApi(page: Page, cards: Card[]) {
  const state = { cards: [...cards], failList: false, failRemove: false, deleted: [] as string[] }
  await page.route(
    url => url.pathname.includes('/me/cards'),
    async route => {
      const request = route.request()
      if (request.method() === 'OPTIONS') return route.fallback()
      const headers = cors(route)
      const fail = (error: string) =>
        route.fulfill({ status: 500, contentType: 'application/json', headers, body: JSON.stringify({ error, message: 'The server could not answer.' }) })
      if (request.method() === 'GET') {
        if (state.failList) return fail('internal_error')
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ cards: state.cards }) })
      }
      if (request.method() === 'DELETE') {
        if (state.failRemove) return fail('internal_error')
        const id = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() ?? '')
        state.deleted.push(id)
        state.cards = state.cards.filter(card => card.id !== id)
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ removed: true }) })
      }
      return route.fallback()
    },
  )
  return state
}

/** Sign a member in with nothing to celebrate over the page (see member-read-failures.spec.ts). */
async function signInQuietly(page: Page, member: { token: string }): Promise<void> {
  await page.route(
    url => url.pathname.endsWith('/me/approvals'),
    async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors(route), body: JSON.stringify({ approvals: [] }) })
    },
  )
  await signInMember(page, member)
}

function savedCards(page: Page) {
  return page.getByRole('region', { name: 'Saved cards' })
}

function cardRow(page: Page, last4: string) {
  return savedCards(page).getByRole('listitem').filter({ hasText: last4 })
}

test('PAY-79 a Saved cards read that fails says it could not load with Try again, never that there are none, and Try again brings the cards back', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  const api = await cardsApi(page, [visa])
  api.failList = true

  await page.goto(`${urls.client}/account/profile`)
  await expect(savedCards(page).getByText("Couldn't load your saved cards.")).toBeVisible()
  await expect(savedCards(page).getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText("You don't have any saved cards.")).toHaveCount(0)
  await expect(cardRow(page, '4242')).toHaveCount(0)

  api.failList = false
  await savedCards(page).getByRole('button', { name: 'Try again' }).click()
  await expect(cardRow(page, '4242')).toBeVisible()
  await expect(savedCards(page).getByText("Couldn't load your saved cards.")).toHaveCount(0)
})

test('PAY-79 a member with no saved cards is told so, once the read succeeded', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  await cardsApi(page, [])

  await page.goto(`${urls.client}/account/profile`)
  await expect(savedCards(page).getByText("You don't have any saved cards.")).toBeVisible()
  await expect(savedCards(page).getByText("Couldn't load your saved cards.")).toHaveCount(0)
})

test('PAY-80 Remove asks in the page first, Keep card changes nothing, and confirming removes that card and leaves the other', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  const api = await cardsApi(page, [visa, amex])
  // A browser confirm() would show as a dialog and be dismissed here, which would fail the removal below.
  page.on('dialog', dialog => dialog.dismiss())

  await page.goto(`${urls.client}/account/profile`)
  await expect(cardRow(page, '4242')).toContainText('Visa')
  await expect(cardRow(page, '4242')).toContainText('Expires 04/99')
  await expect(cardRow(page, '0005')).toContainText('American Express')

  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await expect(page.getByText('Remove this card?')).toBeVisible()
  expect(api.deleted).toEqual([])

  await page.getByRole('button', { name: 'Keep card' }).click()
  await expect(page.getByText('Remove this card?')).toHaveCount(0)
  await expect(cardRow(page, '4242')).toBeVisible()
  expect(api.deleted).toEqual([])

  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await page.getByRole('button', { name: 'Confirm removing Visa ending 4242' }).click()
  await expect(cardRow(page, '4242')).toHaveCount(0)
  await expect(cardRow(page, '0005')).toBeVisible()
  expect(api.deleted).toEqual([visa.id])
})

test('PAY-80 a remove that fails keeps the card and says it is still saved, and a second try can remove it', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  const api = await cardsApi(page, [visa])
  api.failRemove = true

  await page.goto(`${urls.client}/account/profile`)
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await page.getByRole('button', { name: 'Confirm removing Visa ending 4242' }).click()
  await expect(page.getByRole('alert').filter({ hasText: "It's still saved." })).toBeVisible()
  await expect(cardRow(page, '4242')).toBeVisible()
  await expect(page.getByText("You don't have any saved cards.")).toHaveCount(0)

  api.failRemove = false
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await page.getByRole('button', { name: 'Confirm removing Visa ending 4242' }).click()
  await expect(cardRow(page, '4242')).toHaveCount(0)
  await expect(savedCards(page).getByText("You don't have any saved cards.")).toBeVisible()
})
