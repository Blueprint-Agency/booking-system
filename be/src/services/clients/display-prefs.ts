/**
 * A member's General settings in the member app: light or dark, and the text
 * size. Kept on their row at this studio so a choice made on one device follows
 * them to the next one they sign in on.
 *
 * The member's own, and only theirs: no staff path sets it, and nothing is
 * audited, because it changes how the app looks to them and nothing the studio
 * keeps.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { NotFoundError } from '../../shared/errors'
import type { ClientRow } from './manage'

export type DisplayPrefs = {
  theme?: NonNullable<ClientRow['theme']>
  fontSize?: NonNullable<ClientRow['fontSize']>
}

/** Sets the fields given and leaves the others as they are. */
export async function setDisplayPrefs(
  tenantId: string,
  clientId: string,
  prefs: DisplayPrefs,
): Promise<ClientRow> {
  const [row] = await db
    .update(clients)
    .set({ ...prefs, updatedAt: new Date() })
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .returning()
  if (!row) throw new NotFoundError('client_not_found')
  return row
}
