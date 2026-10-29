import { randomBytes } from 'node:crypto'
import { after } from 'node:test'
import { withEnv } from './with-env'

/**
 * Every studio an Admin reads their attention in carries `payments_not_configured`
 * until ReserveToday connects its payments. A test about some other kind
 * connects its studio's payments through the real service so that item is not
 * in its counts. Call `usePaymentKey()` inside the `describe`, then
 * `connectPayments(studioId)` for each studio.
 *
 * The credentials rows live in the test database, which every test file shares,
 * and some studios outlast their file (the harness's own). So the `describe`
 * clears what it connected when it ends: a later file that counts the studios
 * with an account (`payment-credentials.test.ts`) must find none of ours.
 */
const connected = new Set<string>()

export function usePaymentKey(): void {
  withEnv({ PAYMENT_CREDENTIALS_KEY: randomBytes(32).toString('base64') })
  after(async () => {
    const { clearProviderCredentials } = await import('../services/billing/provider-credentials')
    const studios = [...connected]
    connected.clear()
    for (const tenantId of studios) await clearProviderCredentials(tenantId)
  })
}

export async function connectPayments(
  tenantId: string,
  accountId = 'acct_attention_test',
): Promise<void> {
  const [{ saveProviderCredentials }, { withTenant }] = await Promise.all([
    import('../services/billing/provider-credentials'),
    import('../db'),
  ])
  connected.add(tenantId)
  await withTenant(tenantId, () =>
    saveProviderCredentials(tenantId, {
      accountId,
      secretKey: 'sk_test_attention_secret_key',
      webhookSecret: 'whsec_attention_secret',
    }),
  )
}
