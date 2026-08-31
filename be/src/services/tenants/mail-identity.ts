import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { PLATFORM_MAIL_FROM_EMAIL, PLATFORM_MAIL_FROM_NAME } from '../../lib/mailer'

/**
 * The identity one tenant's transactional mail wears.
 *
 * `fromEmail` is the platform's authenticated address in every case a tenant has
 * not been given a delegated one — see docs/md/mail-identity.md for why sending
 * as `hello@a-studio.com` on the platform's SMTP credentials fails SPF and DKIM
 * and is therefore not the v1 shape. `fromName` and `replyTo` are the two parts
 * of the identity that need no DNS at all, and they are what make the mail
 * recognisably the studio's.
 */
export type TenantMailIdentity = {
  fromName: string
  fromEmail: string
  replyTo: string | null
}

type IdentityRow = {
  tenant_name: string | null
  from_name: string | null
  from_email: string | null
  reply_to: string | null
}

/** A tenant row changes about never, and every email sent is one of these. */
const TTL_MS = 60_000
const cache = new Map<string, { at: number; value: TenantMailIdentity }>()

/** Called whenever a tenant's settings are written, so no stale name is sent. */
export function forgetCachedMailIdentity(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

/**
 * Read the current transaction's mail identity, falling back to the platform's.
 *
 * The lookup goes through `current_tenant_mail_identity()` (migration 0036)
 * rather than a plain select, because the application role has no SELECT on the
 * mail columns of `tenant_settings` — deliberately, since that table carries no
 * Row-Level Security policy. The function answers only for the tenant whose
 * context is open, so this cannot read another studio's identity even if asked.
 *
 * The `tenantId` argument is the cache key, not the lookup key: it must be the
 * tenant whose `withTenant` scope this call is running inside, which is what
 * every caller already has in hand.
 *
 * Falls back rather than throwing. A missing settings row must not stop a
 * booking confirmation going out; a plainly-addressed email is better than none.
 */
export async function tenantMailIdentity(tenantId: string): Promise<TenantMailIdentity> {
  const cached = cache.get(tenantId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value

  const rows = (await db.execute(
    sql`SELECT tenant_name, from_name, from_email, reply_to FROM current_tenant_mail_identity()`,
  )) as unknown as IdentityRow[]

  const row = rows[0]
  const value: TenantMailIdentity = {
    fromName: row?.from_name || row?.tenant_name || PLATFORM_MAIL_FROM_NAME,
    fromEmail: row?.from_email || PLATFORM_MAIL_FROM_EMAIL,
    replyTo: row?.reply_to || null,
  }

  cache.set(tenantId, { at: Date.now(), value })
  return value
}

/**
 * The studio's own name, wherever the platform speaks on its behalf — the line
 * copy on a Stripe charge, the inviter shown on an invitation, an email
 * variable.
 *
 * Same lookup and the same fallback as the envelope, deliberately: a member
 * reading a bank statement and a member reading a booking confirmation should
 * see one studio, not two spellings of it. A name that renders empty is worse
 * than one that renders the platform's.
 */
export async function tenantDisplayName(tenantId: string): Promise<string> {
  return (await tenantMailIdentity(tenantId)).fromName
}
