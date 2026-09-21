import { env } from '../../env'
import { providerAccountForKey } from '../../lib/stripe'
import { secretKeyProblem } from '../../lib/secret-box'
import { logger } from '../../shared/logger'
import {
  clearProviderCredentials,
  saveProviderCredentials,
  type ProviderAccountStatus,
} from './provider-credentials'

/**
 * Moving a studio onto its own payment account — the rule, in one place.
 *
 * It lives here rather than in the route because it is a domain rule and not a
 * response shape: what has to be true before a studio's credentials may be
 * stored, in what order, and what is allowed to be said about a failure. A
 * route that held it would be the second place that rule lived the moment
 * anything else needed to configure a studio.
 *
 * It also cannot live in `provider-credentials.ts`, which is the store: that
 * module is imported by `lib/stripe.ts`, and validating a key needs a provider
 * client from exactly there. This file is where the two meet.
 */

/**
 * Why a studio could not be moved onto its own account, in the two kinds a
 * caller has to tell apart.
 *
 * `storage_unavailable` is the operator's environment — nothing was attempted,
 * and nothing is wrong with what they typed. `key_rejected` is the input.
 */
export type OnboardingFailure = 'storage_unavailable' | 'key_rejected'

export class ProviderOnboardingError extends Error {
  constructor(readonly reason: OnboardingFailure, message: string) {
    super(message)
    this.name = 'ProviderOnboardingError'
  }
}

export type ConfiguredAccount = ProviderAccountStatus & { accountId: string }

/**
 * Validate a studio's credentials against the provider, then store them.
 *
 * In that order, and the order is the point. The key is proved before it is
 * sealed, so a typo is caught here — at a form, by a person who can still fix
 * it — rather than at a member's checkout weeks later, against a key nobody can
 * read back to see what went wrong.
 *
 * The account id is the provider's own answer, not the operator's claim, which
 * is what makes "these credentials belong to acct_xxx" a fact rather than a
 * label. The signing secret is not validated, because the provider offers no
 * way to ask; the studio's first delivery is what proves it.
 */
export async function configureProviderAccount(
  tenantId: string,
  input: { secretKey: string; webhookSecret: string },
): Promise<ConfiguredAccount> {
  // Said before anything is attempted, because the failure is the operator's
  // environment and not their input — and because the alternative is a studio's
  // live key travelling to a server that cannot seal it.
  const problem = secretKeyProblem(env.PAYMENT_CREDENTIALS_KEY)
  if (problem) {
    logger.error({ tenantId }, `payment credentials cannot be stored — ${problem}`)
    throw new ProviderOnboardingError('storage_unavailable', problem)
  }

  let accountId: string
  try {
    accountId = await providerAccountForKey(input.secretKey)
  } catch (err) {
    // The provider's own words are deliberately not carried forward. An error
    // raised by a bad key can echo the key back, and the caller's next move is
    // to put this in front of a person.
    logger.warn({ tenantId }, 'payment credentials rejected by the provider')
    void err
    throw new ProviderOnboardingError(
      'key_rejected',
      'the payment provider did not accept that secret key',
    )
  }

  const status = await saveProviderCredentials(tenantId, { ...input, accountId })
  return { ...status, accountId }
}

/**
 * Take a studio back off its own account.
 *
 * The only way out of credentials that turn out to be wrong, because the way
 * that would seem obvious — look at what is stored — does not exist by design.
 */
export async function releaseProviderAccount(tenantId: string): Promise<ProviderAccountStatus> {
  return clearProviderCredentials(tenantId)
}
