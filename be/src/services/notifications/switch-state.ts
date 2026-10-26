import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { emailSwitches } from '../../db/schema/content'
import { auditLog } from '../../db/schema/ledger'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { isStudioEmailSlug, STUDIO_EMAILS, type EmailAudience, type StudioEmailSlug } from './switches'

/** One of the studio's emails as its admin sees it. */
export interface StudioEmail {
  slug: StudioEmailSlug
  audience: EmailAudience
  locked: boolean
  enabled: boolean
}

const LOCKED_MESSAGE = 'This email is always sent, so it cannot be switched off.'

/** Whether `slug` goes out at this studio. A locked email always does, and its stored switch is never read. */
export async function emailEnabled(tenantId: string, slug: StudioEmailSlug): Promise<boolean> {
  if (STUDIO_EMAILS[slug].locked) return true
  const [row] = await db
    .select({ enabled: emailSwitches.enabled })
    .from(emailSwitches)
    .where(and(eq(emailSwitches.tenantId, tenantId), eq(emailSwitches.slug, slug)))
  return row?.enabled ?? true
}

/** Every email the studio sends, grouped by who receives it. */
export async function listStudioEmails(tenantId: string): Promise<Record<EmailAudience, StudioEmail[]>> {
  const rows = await db
    .select({ slug: emailSwitches.slug, enabled: emailSwitches.enabled })
    .from(emailSwitches)
    .where(eq(emailSwitches.tenantId, tenantId))
  const stored = new Map(rows.map(r => [r.slug, r.enabled]))
  const groups: Record<EmailAudience, StudioEmail[]> = { member: [], staff: [] }
  for (const [slug, { audience, locked }] of Object.entries(STUDIO_EMAILS)) {
    groups[audience].push({
      slug: slug as StudioEmailSlug,
      audience,
      locked,
      enabled: locked || (stored.get(slug) ?? true),
    })
  }
  return groups
}

/**
 * Switch one email on or off for the whole studio, with an audit row when it
 * changes. `email_not_found` for a slug the studio does not send,
 * `email_locked` for one it cannot stop.
 */
export async function setEmailSwitch(
  tenantId: string,
  slug: string,
  enabled: boolean,
  actorStaffId: string,
): Promise<StudioEmail> {
  if (!isStudioEmailSlug(slug)) throw new NotFoundError('email_not_found')
  const { audience, locked } = STUDIO_EMAILS[slug]
  if (locked) throw new ConflictError('email_locked', { message: LOCKED_MESSAGE })

  // One statement, so two admins switching the same email at once take turns on
  // the row. It returns a row only when it wrote one: an insert (no row was on),
  // or an update that changed the value. `xmax = 0` marks the insert.
  const [written] = await db
    .insert(emailSwitches)
    .values({ tenantId, slug, enabled })
    .onConflictDoUpdate({
      target: [emailSwitches.tenantId, emailSwitches.slug],
      set: { enabled },
      setWhere: sql`${emailSwitches.enabled} <> ${enabled}`,
    })
    .returning({ id: emailSwitches.id, inserted: sql<boolean>`xmax = 0` })

  const from = written?.inserted ? true : !enabled
  if (written && from !== enabled) {
    await db.insert(auditLog).values({
      tenantId,
      actorStaffId,
      actorType: 'staff',
      action: 'email_switch_changed',
      targetTable: 'email_switches',
      targetId: written.id,
      payload: { slug, from, to: enabled },
    })
  }
  return { slug, audience, locked, enabled }
}
