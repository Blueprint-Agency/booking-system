import { Resend } from 'resend'
import { withTenant } from '../../db'
import { tenantForClassPassToken } from '../../db/routing'
import { currentEnv, env } from '../../env'
import { outbound, OFF_REQUEST_RETRY } from '../../lib/outbound'
import { logger } from '../../shared/logger'
import { addressOf, receiveClassPassEmail, type InboundEmail } from './receive'

/**
 * Resend's `email.received` webhook, for mail to a ClassPass address (#409).
 *
 * The route has verified the Svix signature. This finds the studio from the
 * token in the recipient address, fetches the message (the event carries only
 * its metadata), and hands it to `receiveClassPassEmail` inside that studio's
 * Tenant context. Mail it can't place — no inbound domain configured, no
 * ClassPass address among the recipients, a token no studio holds (never
 * issued, or regenerated away) — is logged and dropped, never an error: Resend
 * would only retry it.
 */

/** The metadata of Resend's `email.received` event. */
export type ReceivedEventData = {
  email_id?: string
  to?: string[] | null
  received_for?: string[] | null
}

/** Fetches a received message by its Resend id. Swappable for tests. */
export type InboundFetcher = (emailId: string) => Promise<InboundEmail>

type Received = {
  from: string
  to: string[]
  subject: string
  created_at: string
  message_id: string
  html: string | null
  text: string | null
  headers: Record<string, string> | null
  // Returned by the API, though not yet in the SDK's types.
  authentication?: { dkim?: string | null; spf?: string | null; dmarc?: string | null } | null
}

const resendFetcher: InboundFetcher = async emailId => {
  const resend = new Resend(env.RESEND_API_KEY)
  const received = await outbound(
    'resend',
    'emails.receiving.get',
    async () => {
      const { data, error } = await resend.emails.receiving.get(emailId)
      if (error || !data) {
        throw Object.assign(new Error(`resend receiving.get failed: ${error?.message ?? 'no data'}`), {
          statusCode: (error as { statusCode?: number } | null)?.statusCode,
        })
      }
      return data as unknown as Received
    },
    { retry: OFF_REQUEST_RETRY },
  )
  return {
    messageId: received.message_id,
    from: received.from,
    to: received.to ?? [],
    subject: received.subject ?? '',
    text: received.text,
    html: received.html,
    headers: received.headers,
    authentication: received.authentication ?? null,
    receivedAt: new Date(received.created_at),
  }
}

let fetcher: InboundFetcher = resendFetcher

/** Swap the message fetcher — for tests. Returns the undo. */
export function useInboundFetcher(next: InboundFetcher): () => void {
  const was = fetcher
  fetcher = next
  return () => {
    fetcher = was
  }
}

/**
 * The token of the first recipient on the inbound domain. The envelope
 * recipient (`received_for`) comes first: Gmail forwarding leaves To: as the
 * studio's own mailbox.
 */
function classPassToken(data: ReceivedEventData, domain: string): string | null {
  const suffix = `@${domain.trim().toLowerCase()}`
  for (const recipient of [...(data.received_for ?? []), ...(data.to ?? [])]) {
    const address = addressOf(recipient)
    if (address.endsWith(suffix)) {
      const token = address.slice(0, -suffix.length)
      if (token) return token
    }
  }
  return null
}

export async function handleInboundEmail(data: ReceivedEventData): Promise<void> {
  const domain = currentEnv('CLASSPASS_INBOUND_DOMAIN')
  if (!domain) {
    logger.warn({ emailId: data.email_id }, 'classpass inbound: no inbound domain configured; dropped')
    return
  }
  const token = classPassToken(data, domain)
  const tenantId = token ? await tenantForClassPassToken(token) : null
  if (!tenantId || !data.email_id) {
    logger.info({ emailId: data.email_id, hadToken: Boolean(token) }, 'classpass inbound: no studio for this address; dropped')
    return
  }

  const message = await fetcher(data.email_id)
  const result = await withTenant(tenantId, () => receiveClassPassEmail(tenantId, message))
  logger.info({ tenantId, emailId: data.email_id, ...result }, 'classpass inbound: received')
}
