import { Hono } from 'hono'
import { requirePlatformAdmin } from '../../middleware/platform-admin'
import tenants from './tenants'

/**
 * The super portal's branch: `/api/v1/platform/*`.
 *
 * Mounted beside `/portal` rather than inside it, deliberately. Everything under
 * `/portal` runs `clerkStaffAuth`, which resolves a tenant, checks the Clerk
 * organization claim against it and reads a `staff_users` row — three things
 * that are meaningless for a caller who belongs to no studio and is asking about
 * all of them. Nesting the super portal there would have meant carving
 * exceptions into the middleware every tenant-scoped request depends on, which
 * is how a tenancy gate stops being a gate.
 *
 * So: one gate, `requirePlatformAdmin`, and no tenant context at all.
 */
const app = new Hono().use('*', requirePlatformAdmin).route('/', tenants)

export default app
