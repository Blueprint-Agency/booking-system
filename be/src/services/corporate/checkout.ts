/**
 * What a corporate package costs and what happens next (fe-client-features
 * §6.2, be-client § Corporate branch).
 *
 * Corporate is paid by card at the package's price: no credits, no Promotion,
 * no Promo Code. The payment is what makes the member's one pending Corporate
 * Request — the webhook does that, in `createCorporateRequest` — so this only
 * prices the sale and names it for the webhook to read back.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { corporatePackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { toCents } from '../../shared/money'
import { grantsWithoutPaying, saleDescription, type CheckoutQuote } from '../billing/checkout-session'
import { openSettledPurchase } from '../billing/purchases'
import { saleLine } from '../billing/purchase-lines'
import { tenantDisplayName } from '../tenants/mail-identity'
import { sendCorporatePurchaseEmail } from '../notifications/send-purchase-email'
import { createCorporateRequest } from './requests'

export type CorporateCheckout = CheckoutQuote<{ corporateRequestId: string }>

export async function beginCorporateCheckout(
  tenantId: string,
  clientId: string,
  packageId: string,
): Promise<CorporateCheckout> {
  const [pkg] = await db
    .select()
    .from(corporatePackages)
    .where(
      and(
        eq(corporatePackages.tenantId, tenantId),
        eq(corporatePackages.id, packageId),
        isNull(corporatePackages.deletedAt),
      ),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('corporate_package_not_found')
  if (pkg.status !== 'active') throw new BadRequestError('corporate_package_not_active')

  const metadata = {
    kind: 'corporate_package',
    package_id: pkg.id,
    client_id: clientId,
    amount_sgd: pkg.priceSgd,
  }

  // Nothing to charge: the provider is skipped, as for any free sale (§10), and
  // the request is made here because there is no webhook coming to make it.
  const cents = toCents(pkg.priceSgd)
  // No Promotion and no Promo Code: the one line is the package at its price (#382).
  const lines = [saleLine({ description: pkg.name, listPriceSgd: pkg.priceSgd })]
  if (grantsWithoutPaying(cents)) {
    const purchase = await openSettledPurchase({ tenantId, clientId, kind: 'corporate_package', metadata, lines })
    const { corporateRequestId } = await createCorporateRequest(tenantId, {
      clientId,
      corporatePackageId: pkg.id,
      purchaseId: purchase.id,
    })
    // Confirmed as every free purchase is (NTF-03), at S$0.00, once the
    // request's transaction has committed (`afterCommit`). The sender reports
    // and swallows, so a failed send cannot undo the request.
    afterCommit(() => sendCorporatePurchaseEmail(tenantId, corporateRequestId, null))
    return { outcome: 'granted', corporateRequestId }
  }

  return {
    outcome: 'checkout',
    lines: [
      {
        name: pkg.name,
        description: saleDescription(await tenantDisplayName(tenantId)),
        amountCents: cents,
      },
    ],
    purchaseLines: lines,
    expiresAt: null,
    metadata,
  }
}
