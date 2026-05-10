import { createClerkClient } from '@clerk/backend'

/**
 * Two Clerk applications per spec §6a — separate publishable + secret keys,
 * separate JWT issuers, separate user pools. Cross-app tokens are rejected.
 */
export const clerkClientApp = createClerkClient({
  secretKey: process.env.CLERK_CLIENT_SECRET_KEY!,
})

export const clerkStaffApp = createClerkClient({
  secretKey: process.env.CLERK_STAFF_SECRET_KEY!,
})
