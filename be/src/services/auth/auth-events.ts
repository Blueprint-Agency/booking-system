import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware, getIP, isAPIError } from 'better-auth/api'
import { currentTenantId, db } from '../../db'
import type { AuthEventKind } from '../../db/enums'
import { authEvents } from '../../db/schema'
import { authEventKind } from './auth-event-kind'
import type { AuthPool } from './better-auth'

/**
 * The sign-in audit log: "who signed in as whom, when" as a query on our own
 * database (#114), and the actor id every log line will carry (#105 story 16).
 */

export type AuthEvent = {
  pool: AuthPool
  kind: AuthEventKind
  /** The auth user in `pool` this happened to or was done by, when known. */
  actorUserId: string | null
  /** The user acted on, when not the actor — the member an impersonation signs in as. */
  subjectUserId?: string | null
  ip: string | null
  userAgent: string | null
}

/**
 * Write one event, filed under the Tenant whose context is open.
 *
 * A studio pool's event is always inside one — `resolveTenant` opens it before
 * the auth handler runs — and a platform event never is. Refusing a studio
 * event outside a context is what stops it being filed as the platform's: with
 * no Tenant it would be a null row, which the policy on this table reads as
 * the super portal's (`PLATFORM_ROWS`, `db/roles.ts`).
 *
 * In the request's own transaction, so a sign-in whose row cannot be written
 * does not happen either.
 */
export async function recordAuthEvent(event: AuthEvent): Promise<void> {
  const tenantId = event.pool === 'platform' ? null : currentTenantId()
  if (event.pool !== 'platform' && !tenantId) {
    throw new Error(`recordAuthEvent: a ${event.pool} event outside a Tenant context would be filed as the platform's`)
  }
  await db.insert(authEvents).values({
    tenantId,
    pool: event.pool,
    kind: event.kind,
    actorUserId: event.actorUserId,
    subjectUserId: event.subjectUserId ?? null,
    ip: event.ip,
    userAgent: event.userAgent,
  })
}

type EndpointContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/** The two-factor plugin's challenge cookie, which names the user mid-sign-in. */
const TWO_FACTOR_CHALLENGE_COOKIE = 'two_factor'

/**
 * Who a request that did not end signed in was about: the account behind the
 * address it named, or the one whose second factor is being asked for.
 *
 * The address itself is never kept, only the id it resolves to — so a failed
 * sign-in for an address with no account records no one.
 */
async function attemptedUserId(ctx: EndpointContext): Promise<string | null> {
  const body = ctx.body as { email?: unknown } | undefined
  if (typeof body?.email === 'string') {
    const found = await ctx.context.internalAdapter.findUserByEmail(body.email)
    return found?.user.id ?? null
  }
  if (ctx.path.startsWith('/two-factor/')) {
    if (ctx.context.session) return ctx.context.session.user.id
    const cookie = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE_COOKIE)
    const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
    if (!challenge) return null
    const pending = await ctx.context.internalAdapter.findVerificationValue(challenge)
    return pending?.value ?? null
  }
  return null
}

function whereFrom(ctx: EndpointContext): Pick<AuthEvent, 'ip' | 'userAgent'> {
  const headers = ctx.request?.headers ?? ctx.headers
  return {
    ip: headers ? getIP(headers, ctx.context.options) : null,
    userAgent: headers?.get('user-agent') ?? null,
  }
}

/**
 * The audit log as a Better Auth plugin: one per pool, and **listed last**.
 *
 * Last, because plugin after-hooks run in order and the two-factor plugin's is
 * the one that deletes the half-made session of a password sign-in that still
 * owes a second factor. Run before it, this would see that session and file a
 * sign-in that has not happened. (User-level `hooks.after` runs before every
 * plugin's, which is why this is not one.)
 *
 * Sign-out is caught as the session row is deleted rather than after the
 * request: by then the session, and so the person, is gone. An impersonation's
 * start is written by the service that opens it (`services/impersonation/mint.ts`),
 * which does not go through an endpoint.
 */
export function authAudit(pool: AuthPool) {
  return {
    id: 'auth-audit',
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            delete: {
              before: async (session: { userId: string; impersonatedBy?: string | null }, ctx: EndpointContext | null) => {
                if (ctx?.path !== '/sign-out') return
                // Signing an impersonation session out is how it stops (#118):
                // filed like its start, as the superadmin's act on the member.
                if (session.impersonatedBy) {
                  await recordAuthEvent({
                    pool: 'staff',
                    kind: 'impersonation_ended',
                    actorUserId: session.impersonatedBy,
                    subjectUserId: session.userId,
                    ...whereFrom(ctx),
                  })
                  return
                }
                await recordAuthEvent({ pool, kind: 'sign_out', actorUserId: session.userId, ...whereFrom(ctx) })
              },
            },
          },
        },
      },
    }),
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async ctx => {
            const newSession = ctx.context.newSession
            const kind = authEventKind({
              path: ctx.path,
              failed: isAPIError(ctx.context.returned),
              newSession: Boolean(newSession),
              // Set by whatever read the caller's session during the request;
              // the sign-in endpoints read none, a challenge has none to read.
              hadSession: Boolean(ctx.context.session),
            })
            if (!kind) return
            const actorUserId = newSession?.user.id ?? (await attemptedUserId(ctx))
            await recordAuthEvent({ pool, kind, actorUserId, ...whereFrom(ctx) })
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
