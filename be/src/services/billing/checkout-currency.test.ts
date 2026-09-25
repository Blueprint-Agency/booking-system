import test from 'node:test'
import assert from 'node:assert/strict'

import { checkoutSessionParams, type CheckoutSessionInput } from './checkout-session'

const sessionInput = (over: Partial<CheckoutSessionInput> = {}): CheckoutSessionInput => ({
  tenantId: 't1',
  email: 'member@example.com',
  lines: [{ name: 'Class Pack · 10', description: 'Acme Yoga', amountCents: 340_00 }],
  expiresAt: null,
  metadata: { kind: 'class_package', client_id: 'c-1' },
  successUrl: 'https://studio.example/ok',
  cancelUrl: 'https://studio.example/no',
  ...over,
})

test('a checkout is charged in SGD only — the provider offers no other currency', () => {
  const sessions = [
    checkoutSessionParams(sessionInput()),
    checkoutSessionParams(sessionInput({ partPaymentCents: 100_00 })),
    checkoutSessionParams(sessionInput({ customerId: 'cus_1', saveCard: true })),
  ]
  for (const params of sessions) {
    assert.deepEqual(params.adaptive_pricing, { enabled: false })
    assert.ok(params.line_items?.every(item => item.price_data?.currency === 'sgd'))
  }
})
