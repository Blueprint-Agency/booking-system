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
 * answer `500` while true, `failRemove` makes a removal answer `500`, and
 * `refuseRemove` makes it answer that refusal instead (the card stays).
 * `alreadyGone` makes a removal answer `404 card_not_found` and drops the card,
 * as when another device detached it first. Removals that succeed leave the
 * list, as the provider detaching them would.
 */
async function cardsApi(page: Page, cards: Card[]) {
  const state = {
    cards: [...cards],
    failList: false,
    failRemove: false,
    alreadyGone: false,
    refuseRemove: null as null | { status: number; body: Record<string, unknown> },
    deleted: [] as string[],
  }
  await page.route(
    url => url.pathname.includes('/me/cards'),
    async route => {
      const request = route.request()
      if (request.method() === 'OPTIONS') return route.fallback()
      const headers = cors(route)
      const fail = () =>
        route.fulfill({ status: 500, contentType: 'application/json', headers, body: JSON.stringify({ error: 'internal_error', requestId: 'e2e' }) })
      if (request.method() === 'GET') {
        if (state.failList) return fail()
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ cards: state.cards }) })
      }
      if (request.method() === 'DELETE') {
        const id = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() ?? '')
        if (state.refuseRemove) {
          const { status, body } = state.refuseRemove
          return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
        }
        if (state.failRemove) return fail()
        if (state.alreadyGone) {
          state.cards = state.cards.filter(card => card.id !== id)
          return route.fulfill({ status: 404, contentType: 'application/json', headers, body: JSON.stringify({ error: 'card_not_found', requestId: 'e2e' }) })
        }
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

/** The question's confirming button, named by its visible words (WCAG 2.5.3). */
function confirmButton(page: Page, last4: string) {
  return cardRow(page, last4).getByRole('button', { name: 'Remove card', exact: true })
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
  await confirmButton(page, '4242').click()
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
  await confirmButton(page, '4242').click()
  // The list was read again and still has the card, so "still saved" is known, not guessed.
  await expect(page.getByRole('alert').filter({ hasText: "It's still saved." })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Please try again.' })).toBeVisible()
  await expect(cardRow(page, '4242')).toBeVisible()
  await expect(page.getByText("You don't have any saved cards.")).toHaveCount(0)

  api.failRemove = false
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await confirmButton(page, '4242').click()
  await expect(cardRow(page, '4242')).toHaveCount(0)
  await expect(savedCards(page).getByText("You don't have any saved cards.")).toBeVisible()
})

test('PAY-82 a card already removed on another device answers 404, which counts as removed: the card leaves the list and nothing says it is still saved', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  const api = await cardsApi(page, [visa, amex])
  api.alreadyGone = true

  await page.goto(`${urls.client}/account/profile`)
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await confirmButton(page, '4242').click()

  await expect(cardRow(page, '4242')).toHaveCount(0)
  await expect(cardRow(page, '0005')).toBeVisible()
  await expect(savedCards(page).getByRole('status').filter({ hasText: 'Visa ending 4242 removed.' })).toHaveCount(1)
  // Inside the section: Next's own route announcer is an (empty) alert too.
  await expect(savedCards(page).getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('still saved')).toHaveCount(0)
})

test('PAY-83 a remove the server refuses with its own sentence shows that sentence instead of Please try again, and one whose fresh read also fails says only that the card may still be saved', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  const api = await cardsApi(page, [visa])
  api.refuseRemove = { status: 409, body: { error: 'payments_not_configured', message: "This studio isn't taking card payments." } }

  await page.goto(`${urls.client}/account/profile`)
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await confirmButton(page, '4242').click()
  // The one alert in the section; Next's route announcer is another, empty, outside it.
  const refused = savedCards(page).getByRole('alert')
  await expect(refused).toContainText("This studio isn't taking card payments.")
  await expect(refused).toContainText("It's still saved.")
  await expect(refused).not.toContainText('Please try again')

  api.refuseRemove = null
  api.failRemove = true
  api.failList = true
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await confirmButton(page, '4242').click()
  await expect(refused).toContainText('may still be saved')
  await expect(refused).not.toContainText("It's still saved.")
  await expect(cardRow(page, '4242')).toBeVisible()
})

test('PAY-84 after a card is removed, focus moves to the next card’s Remove, or to the Saved cards heading when none is left, and the removal is announced', async ({ page }) => {
  const { urls, members } = studio()
  await signInQuietly(page, members.newcomer)
  await cardsApi(page, [visa, amex])

  await page.goto(`${urls.client}/account/profile`)
  await page.getByRole('button', { name: 'Remove Visa ending 4242' }).click()
  await confirmButton(page, '4242').click()
  await expect(cardRow(page, '4242')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove American Express ending 0005' })).toBeFocused()
  await expect(savedCards(page).getByRole('status').filter({ hasText: 'Visa ending 4242 removed.' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove American Express ending 0005' }).click()
  await confirmButton(page, '0005').click()
  await expect(cardRow(page, '0005')).toHaveCount(0)
  await expect(savedCards(page).getByRole('heading', { name: 'Saved cards' })).toBeFocused()
  await expect(savedCards(page).getByRole('status').filter({ hasText: 'American Express ending 0005 removed.' })).toHaveCount(1)
})
