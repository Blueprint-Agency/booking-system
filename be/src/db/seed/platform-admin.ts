import { parsePlatformAdmins } from '../../services/tenants/platform-admin'
import { ensureAuthUser } from '../../services/auth/auth-users'

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
 * So this seeds the people on `PLATFORM_ADMIN_EMAILS` into the Better Auth
 * `platform` pool — the one the super portal signs in against (#116) — and
 * nothing else. There is no `staff_users` row to write: platform administration
 * deliberately lives outside every studio's rows, so that a studio's own
 * superadmin cannot become one by any write path (see
 * services/tenants/platform-admin.ts).
 *
 * **Passwordless, by design.** The user is created with no credential; on first
 * sign-in the super portal mails the operator a link to set their own
 * (`services/auth/platform-first-sign-in.ts`). That keeps
 * the password out of `.env`, out of CI logs, and off the deployer's disk — the
 * operator owns it and the deployer never sees it.
 *
 * Idempotent: `npm run db:seed` runs on every deploy, and an operator who
 * already exists is left exactly as they are.
 */
export async function seedPlatformAdmins(db: Parameters<typeof ensureAuthUser>[0]) {
  const admins = parsePlatformAdmins(process.env.PLATFORM_ADMIN_EMAILS)
  if (admins.length === 0) {
    console.warn(
      '[seed] PLATFORM_ADMIN_EMAILS is unset — nobody can reach the super portal, so no studio can be created.',
    )
    return
  }

  for (const email of admins) {
    // The address is its own name until the operator says otherwise.
    const authUserId = await ensureAuthUser(db, 'platform', { email, name: email })
    console.log(
      `[seed] platform admin ${email} present in the platform auth pool (${authUserId}) — enter the email at the super portal to be mailed a set-password link`,
    )
  }
}
