import { Hono } from 'hono'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages } from '../../db/schema/packages'
import { eq, and, or, isNull, gt, desc } from 'drizzle-orm'

const app = new Hono()
  .get('/', c => c.json({ todo: 'own profile' }, 501))
  .patch('/', c => c.json({ todo: 'update name/phone/gender/dob' }, 501))
  .get('/dashboard', c => c.json({ todo: 'next-up + balances' }, 501))
  .get('/packages', async c => {
    const clientId = c.get('clientId')
    const now = new Date()

    const rows = await db
      .select({
        id: clientPackages.id,
        kind: clientPackages.kind,
        creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
        expiresAt: clientPackages.expiresAt,
        purchasedAt: clientPackages.purchasedAt,
        amountPaidSgd: clientPackages.amountPaidSgd,
        classPackageName: classPackages.name,
        ptPackageName: ptPackages.name,
      })
      .from(clientPackages)
      .leftJoin(classPackages, eq(clientPackages.sourceClassPackageId, classPackages.id))
      .leftJoin(ptPackages, eq(clientPackages.sourcePtPackageId, ptPackages.id))
      .where(
        and(
          eq(clientPackages.clientId, clientId),
          // Not expired (or no expiry = unlimited PT)
          or(isNull(clientPackages.expiresAt), gt(clientPackages.expiresAt, now)),
          // Has remaining balance (or null = unlimited class pass)
          or(isNull(clientPackages.creditsOrSessionsRemaining), gt(clientPackages.creditsOrSessionsRemaining, 0)),
        ),
      )
      .orderBy(desc(clientPackages.purchasedAt))

    const packages = rows.map(r => ({
      id: r.id,
      kind: r.kind,
      name: r.classPackageName ?? r.ptPackageName ?? 'Package',
      creditsOrSessionsRemaining: r.creditsOrSessionsRemaining,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      purchasedAt: r.purchasedAt.toISOString(),
      amountPaidSgd: r.amountPaidSgd,
    }))

    const classTotal = packages
      .filter(p => p.kind === 'credit_bundle')
      .reduce((sum, p) => sum + (p.creditsOrSessionsRemaining ?? 0), 0)

    const unlimitedPkg = packages.find(p => p.kind === 'unlimited')

    const ptTotal = packages
      .filter(p => p.kind === 'pt')
      .reduce((sum, p) => sum + (p.creditsOrSessionsRemaining ?? 0), 0)

    return c.json({
      classCredits: {
        total: classTotal,
        isUnlimited: !!unlimitedPkg,
        unlimitedExpiresAt: unlimitedPkg?.expiresAt ?? null,
      },
      ptSessions: { total: ptTotal },
      packages,
    })
  })

export default app
