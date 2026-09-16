/**
 * Who is allowed to operate the super portal.
 *
 * A platform administrator is *not* a Tenant's superadmin. `staff_users.role`
 * says what someone may do inside one studio; this says who may create studios
 * at all, and the two must not be the same thing — a studio's own superadmin
 * reaching the super portal would be able to create, list and suspend every
 * other studio on the platform.
 *
 * So the allowlist lives outside the database entirely, in the environment,
 * alongside the other deploy-time secrets. That is deliberate:
 *
 *  - There is no row to compromise. Escalating to platform admin means editing
 *    the deploy environment, not finding a write path into a table.
 *  - It cannot be reached by a tenant-scoped bug. Every other table is fenced by
 *    Row-Level Security keyed on the open Tenant context; a list that is *about*
 *    every tenant has no honest tenant context to be fenced by.
 *  - The dev team is a handful of people who change about never.
 *
 * `PLATFORM_ADMIN_EMAILS` is the whole of the list. `SUPERADMIN_EMAIL` used to
 * be folded in by the caller, as a bootstrap convenience so that a deployment
 * setting nothing new kept one platform admin rather than none. That
 * convenience was the escalation described above, granted by default: it made
 * the first studio's superadmin an operator of every studio on the platform.
 *
 * An empty allowlist is therefore allowed, and means a super portal nobody can
 * reach. That is the right failure for an unset environment variable — refusing
 * everyone is recoverable, admitting a studio's superadmin to the whole platform
 * is not — and `middleware/platform-admin.ts` announces it at boot rather than
 * leaving it to be discovered at the door.
 */

/**
 * Comparison form for an email address. Lowercased and trimmed, because the
 * domain half is case-insensitive by RFC and every mail provider we care about
 * treats the local half that way too — and because an allowlist that could be
 * defeated by capitalisation is not an allowlist.
 */
function fold(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * `PLATFORM_ADMIN_EMAILS` is a comma-separated list. Blank entries are dropped
 * rather than kept as empty strings — a trailing comma must not admit a caller
 * whose email failed to parse.
 */
export function parsePlatformAdmins(...raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const value of raw) {
    if (!value) continue
    for (const entry of value.split(',')) {
      const folded = fold(entry)
      if (folded) seen.add(folded)
    }
  }
  return [...seen]
}

/**
 * Is this address on the list?
 *
 * Returns false for a null or blank address, so a Clerk user with no primary
 * email — which is possible; Clerk allows phone-only accounts — is refused
 * rather than matched against a blank entry.
 */
export function isPlatformAdmin(
  email: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!email) return false
  const folded = fold(email)
  if (!folded) return false
  return allowlist.includes(folded)
}
