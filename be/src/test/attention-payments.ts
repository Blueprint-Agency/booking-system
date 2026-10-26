import { randomBytes } from 'node:crypto'
import { withEnv } from './with-env'

/**
 * Every studio an Admin reads their attention in carries `payments_not_configured`
 * until ReserveToday connects its payments (#489). A test about some other kind
 * connects its studio's payments through the real service so that item is not
 * in its counts. Call `usePaymentKey()` inside the `describe`, then
 * `connectPayments(studioId)` for each studio.
 */
export function usePaymentKey(): void {
  withEnv({ PAYMENT_CREDENTIALS_KEY: randomBytes(32).toString('base64') })
}

export async function connectPayments(
  tenantId: string,
  accountId = 'acct_attention_test',
): Promise<void> {
  const [{ saveProviderCredentials }, { withTenant }] = await Promise.all([
    import('../services/billing/provider-credentials'),
    import('../db'),
  ])
  await withTenant(tenantId, () =>
    saveProviderCredentials(tenantId, {
      accountId,
      secretKey: 'sk_test_attention_secret_key',
      webhookSecret: 'whsec_attention_secret',
    }),
  )
}
