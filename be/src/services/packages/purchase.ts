/**
 * On Stripe payment success, insert client_packages row.
 * Called from billing/webhook-handler when kind in {class_package, pt_package}.
 */
import { db } from '../../db'
import { classPackages, ptPackages, clientPackages } from '../../db/schema/packages'
import { stripePayments } from '../../db/schema/ledger'
import { eq } from 'drizzle-orm'

export interface GrantPackageInput {
  clientId: string
  paymentIntentId: string
  amountSgd: string
  packageKind: 'class' | 'pt'
  packageId: string
}

export async function grantPackage(input: GrantPackageInput): Promise<{ clientPackageId: string }> {
  const { clientId, paymentIntentId, amountSgd, packageKind, packageId } = input

  if (packageKind === 'class') {
    const [pkg] = await db.select().from(classPackages)
      .where(eq(classPackages.id, packageId)).limit(1)
    if (!pkg) throw new Error(`class_package not found: ${packageId}`)

    const now = new Date()
    let expiresAt: Date | null = null

    if (pkg.kind === 'credit_bundle' && pkg.validityDays != null) {
      expiresAt = new Date(now.getTime() + pkg.validityDays * 86_400_000)
    } else if (pkg.kind === 'unlimited' && pkg.durationDays != null) {
      expiresAt = new Date(now.getTime() + pkg.durationDays * 86_400_000)
    }

    const [inserted] = await db.insert(clientPackages).values({
      clientId,
      kind: pkg.kind === 'credit_bundle' ? 'credit_bundle' : 'unlimited',
      sourceClassPackageId: packageId,
      creditsOrSessionsRemaining: pkg.kind === 'credit_bundle' ? pkg.credits : null,
      expiresAt,
      amountPaidSgd: amountSgd,
      stripePaymentIntentId: paymentIntentId,
    }).returning({ id: clientPackages.id })
    if (!inserted) throw new Error('failed to insert client_package')

    // Mark payment succeeded and link to the new client_package
    await db.update(stripePayments)
      .set({ clientPackageId: inserted.id, status: 'succeeded' })
      .where(eq(stripePayments.paymentIntentId, paymentIntentId))

    return { clientPackageId: inserted.id }

  } else {
    const [pkg] = await db.select().from(ptPackages)
      .where(eq(ptPackages.id, packageId)).limit(1)
    if (!pkg) throw new Error(`pt_package not found: ${packageId}`)

    const [inserted] = await db.insert(clientPackages).values({
      clientId,
      kind: 'pt',
      sourcePtPackageId: packageId,
      creditsOrSessionsRemaining: pkg.numSessions,
      expiresAt: null,
      amountPaidSgd: amountSgd,
      stripePaymentIntentId: paymentIntentId,
    }).returning({ id: clientPackages.id })
    if (!inserted) throw new Error('failed to insert client_package')

    await db.update(stripePayments)
      .set({ clientPackageId: inserted.id, status: 'succeeded' })
      .where(eq(stripePayments.paymentIntentId, paymentIntentId))

    return { clientPackageId: inserted.id }
  }
}
