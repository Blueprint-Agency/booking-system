import { getClerkPlatformApp, isPlatformAppConfigured } from '../../lib/clerk'
import { parsePlatformAdmins } from '../../services/tenants/platform-admin'

/**
 * The only thing a fresh deployment provisions.
 *
 * Not a studio. Not a studio's premises, catalogue, waiver or email copy —
 * those are a *studio's* data, and a platform that ships with one studio's data
 * baked into its seeders is the single-tenant product this one stopped being.
 * A new deployment is an empty platform with one door into it, and every studio
 * on it arrives afterwards: created from the super portal, or restored from an
 * archive.
 *
 * So this seeds the people on `PLATFORM_ADMIN_EMAILS` into the Clerk
 * application the super portal actually signs in against, and nothing else.
 * There is no `staff_users` row to write — platform administration deliberately
 * lives outside the database, so that a studio's own superadmin cannot become
 * one by any write path (see services/tenants/platform-admin.ts).
 *
 * **Which application that is has to be asked, not assumed.** It is the
 * PLATFORM app where one is configured and the staff app otherwise, which is
 * exactly the question `requirePlatformAdmin` answers on every request. This
 * seeder used to name `clerkStaffApp` outright, and once the super portal moved
 * to its own instance that made the seed a quiet lie: `npm run db:seed` runs on
 * every deploy, so each one would create the operator in the *staff* pool and
 * log "platform admin … created" while the pool the super portal reads stayed
 * empty and nobody could sign in.
 *
 * **Passwordless, by design.** A Clerk user is created with no credential and
 * the operator sets their own via "Forgot password" on first sign-in. That keeps
 * the password out of `.env`, out of CI logs, and off the deployer's disk — the
 * operator owns it and the deployer never sees it. Clerk's own policy, including
 * the breach check, is then enforced at the form where a compliant password can
 * actually be chosen.
 *
 * Fault tolerance: a Clerk failure is logged and skipped rather than thrown. The
 * allowlist is environment, not data, so the gate already works — the account
 * simply has to be created by hand or by the next run.
 */
export async function seedPlatformAdmins() {
  const admins = parsePlatformAdmins(process.env.PLATFORM_ADMIN_EMAILS)
  if (admins.length === 0) {
    console.warn(
      '[seed] PLATFORM_ADMIN_EMAILS is unset — nobody can reach the super portal, so no studio can be created.',
    )
    return
  }

  // Named in the log because the two pools are indistinguishable from the
  // output otherwise, and "created" in the wrong one reads exactly like success.
  const clerk = getClerkPlatformApp()
  const pool = isPlatformAppConfigured() ? 'platform' : 'staff'

  for (const email of admins) {
    try {
      const { data } = await clerk.users.getUserList({ emailAddress: [email] })
      if (data[0]) {
        console.log(
          `[seed] platform admin ${email} already exists in the ${pool} Clerk app — credential left untouched`,
        )
        continue
      }
      // Backend-API-created users have their primary email auto-verified, so the
      // reset flow delivers immediately on first sign-in with no extra step.
      const user = await clerk.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
      })
      console.log(
        `[seed] platform admin ${email} created (${user.id}) in the ${pool} Clerk app — set the password via "Forgot password" on first sign-in`,
      )
    } catch (err) {
      console.warn(`[seed] could not provision platform admin ${email}:`, err)
    }
  }
}
