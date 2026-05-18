import { Hono } from 'hono'
import {
  getClientEntitlements,
  listClientPackages,
} from '../../services/packages/entitlements'

function serializeClientPackage(r: Awaited<ReturnType<typeof listClientPackages>>[number]) {
  return {
    id: r.id,
    kind: r.kind,
    source_package_id: r.sourcePackageId,
    package_name: r.packageName,
    credits_or_sessions_remaining: r.creditsOrSessionsRemaining,
    expires_at: r.expiresAt,
    purchased_at: r.purchasedAt,
    amount_paid_sgd: r.amountPaidSgd,
  }
}

const app = new Hono()
  .get('/', c => c.json({ todo: 'own profile' }, 501))
  .patch('/', c => c.json({ todo: 'update name/phone/gender/dob' }, 501))
  .get('/dashboard', c => c.json({ todo: 'next-up + balances' }, 501))
  .get('/packages', async c => {
    const clientId = c.get('clientId')
    const onlyActive = c.req.query('only_active') === '1'
    const [packages, ent] = await Promise.all([
      listClientPackages(clientId, onlyActive),
      getClientEntitlements(clientId),
    ])
    return c.json({
      client_packages: packages.map(serializeClientPackage),
      entitlements: {
        trial_used: ent.trialUsed,
        has_active_unlimited: ent.hasActiveUnlimited,
        has_active_bundle_credits: ent.hasActiveBundleCredits,
        pt_sessions_remaining: ent.ptSessionsRemaining,
      },
    })
  })

export default app
