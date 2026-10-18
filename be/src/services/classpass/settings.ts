import { randomBytes } from 'node:crypto'
import { eq, max, count } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails, classpassSettings } from '../../db/schema'
import { classpassEmailOutcomeEnum, type ClassPassEmailOutcome } from '../../db/enums'
import { currentEnv } from '../../env'

/**
 * A studio's ClassPass address and switch (#409), and what has arrived at it.
 *
 * The address is `<token>@<CLASSPASS_INBOUND_DOMAIN>`. The token is random, not
 * the Slug, so the address can't be guessed from the studio's name, and a
 * leaked one is replaced by regenerating it.
 */

export type ClassPassSettingsRow = typeof classpassSettings.$inferSelect

export type ClassPassStatus = {
  /** Null when this deployment has no inbound domain configured. */
  address: string | null
  enabled: boolean
  gmailConfirmationCode: string | null
  gmailConfirmationAt: Date | null
  /** When the last email of any outcome arrived; null before the first. */
  lastReceivedAt: Date | null
  counts: Record<ClassPassEmailOutcome, number>
}

/** 128 random bits, lower-case hex: safe as an email local part. */
export function newAddressToken(): string {
  return randomBytes(16).toString('hex')
}

export function classPassAddress(token: string): string | null {
  const domain = currentEnv('CLASSPASS_INBOUND_DOMAIN')?.trim().toLowerCase()
  return domain ? `${token}@${domain}` : null
}

/** The studio's settings row, made with a fresh token (and the import off) the first time it is asked for. */
export async function ensureClassPassSettings(tenantId: string): Promise<ClassPassSettingsRow> {
  await db
    .insert(classpassSettings)
    .values({ tenantId, addressToken: newAddressToken() })
    .onConflictDoNothing({ target: classpassSettings.tenantId })
  const [row] = await db.select().from(classpassSettings).where(eq(classpassSettings.tenantId, tenantId))
  // Invariant: the insert above leaves exactly one row for the Tenant.
  if (!row) throw new Error('classpass settings row missing after insert')
  return row
}

export async function readClassPass(tenantId: string): Promise<ClassPassStatus> {
  const settings = await ensureClassPassSettings(tenantId)
  const rows = await db
    .select({ outcome: classpassInboundEmails.outcome, n: count(), last: max(classpassInboundEmails.receivedAt) })
    .from(classpassInboundEmails)
    .where(eq(classpassInboundEmails.tenantId, tenantId))
    .groupBy(classpassInboundEmails.outcome)

  const counts = Object.fromEntries(classpassEmailOutcomeEnum.enumValues.map(o => [o, 0])) as Record<
    ClassPassEmailOutcome,
    number
  >
  let lastReceivedAt: Date | null = null
  for (const row of rows) {
    counts[row.outcome] = Number(row.n)
    const last = row.last ? new Date(row.last) : null
    if (last && (!lastReceivedAt || last > lastReceivedAt)) lastReceivedAt = last
  }

  return {
    address: classPassAddress(settings.addressToken),
    enabled: settings.enabled,
    gmailConfirmationCode: settings.gmailConfirmationCode,
    gmailConfirmationAt: settings.gmailConfirmationAt,
    lastReceivedAt,
    counts,
  }
}

export async function setClassPassEnabled(tenantId: string, enabled: boolean): Promise<ClassPassStatus> {
  await ensureClassPassSettings(tenantId)
  await db
    .update(classpassSettings)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(classpassSettings.tenantId, tenantId))
  return readClassPass(tenantId)
}

/**
 * A new address. The old token is overwritten, so mail to it resolves to no
 * studio from now on. The Gmail code belonged to the old address and goes too:
 * Gmail asks the new one to confirm afresh.
 */
export async function regenerateClassPassAddress(tenantId: string): Promise<ClassPassStatus> {
  await ensureClassPassSettings(tenantId)
  await db
    .update(classpassSettings)
    .set({
      addressToken: newAddressToken(),
      gmailConfirmationCode: null,
      gmailConfirmationAt: null,
      updatedAt: new Date(),
    })
    .where(eq(classpassSettings.tenantId, tenantId))
  return readClassPass(tenantId)
}
