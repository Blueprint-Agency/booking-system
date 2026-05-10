/**
 * On Stripe payment success, insert client_packages row.
 * Called from billing/webhook-handler when kind in {class_package, pt_package}.
 */
export interface GrantPackageInput {
  clientId: string
  paymentIntentId: string
  amountSgd: string
  packageKind: 'class' | 'pt'
  packageId: string
}

export async function grantPackage(_input: GrantPackageInput): Promise<{ clientPackageId: string }> {
  throw new Error('not implemented')
}
