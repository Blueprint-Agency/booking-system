import assert from 'node:assert/strict'

/** Anything that answers a request as the app does: `startTestApp().app`. */
type Requester = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }

/**
 * The address a test member is billed to when the test is not about Billing
 * details. Named, at save, by the member's own name, as the app prefills it
 * on their first set.
 */
export const TEST_ADDRESS = { line1: '1 Test Street', city: 'Singapore', postcode: '000001' } as const

/**
 * The id of a set of Billing details the signed-in member is billed to, which
 * every member purchase names: their default where they have saved
 * some, otherwise one saved now through their own route, under their own name
 * and `TEST_ADDRESS`, which becomes their default.
 *
 * Asked over HTTP, as the app asks, so a member who has used up their three
 * sets is billed to their default rather than refused a fourth.
 */
async function billingDetailsFor(app: Requester, headers: Record<string, string>): Promise<string> {
  const listed = await app.request('/api/v1/me/billing-details', { headers })
  assert.equal(listed.status, 200, `listing the member's Billing details: ${await listed.clone().text()}`)
  const sets = ((await listed.json()) as { billing_details: { id: string; is_default: boolean }[] }).billing_details
  const held = sets.find(s => s.is_default) ?? sets[0]
  if (held) return held.id

  const me = await app.request('/api/v1/me', { headers })
  assert.equal(me.status, 200, `reading the member's profile: ${await me.clone().text()}`)
  const { name } = (await me.json()) as { name: string }
  const added = await app.request('/api/v1/me/billing-details', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...TEST_ADDRESS }),
  })
  assert.equal(added.status, 201, `saving the member's Billing details: ${await added.clone().text()}`)
  return ((await added.json()) as { billing_details: { id: string } }).billing_details.id
}

/** `body`, a member purchase, naming the member's Billing details as every checkout does. */
export async function billed<T extends Record<string, unknown>>(
  app: Requester,
  headers: Record<string, string>,
  body: T,
): Promise<T & { billing_details_id: string }> {
  return { ...body, billing_details_id: await billingDetailsFor(app, headers) }
}
