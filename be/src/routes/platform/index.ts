import { Hono } from 'hono'
import { requirePlatformAdmin } from '../../middleware/platform-admin'
import signIn, { SIGN_IN_STEP_PATH } from './sign-in'
import tenants from './tenants'
import transfer from './transfer'

/**
 * The super portal's branch: `/api/v1/platform/*`.
 *
 * Mounted beside `/portal` rather than inside it, deliberately. Everything under
 * `/portal` runs `staffAuth`, which resolves a tenant, checks the session's
 * Tenant claim against it and reads a `staff_users` row — three things
 * that are meaningless for a caller who belongs to no studio and is asking about
 * all of them. Nesting the super portal there would have meant carving
 * exceptions into the middleware every tenant-scoped request depends on, which
 * is how a tenancy gate stops being a gate.
 *
 * So: one gate, `requirePlatformAdmin`, and no tenant context at all. The one
 * route outside it is the sign-in step, which runs before there is a session.
 */
const app = new Hono()
  .use('*', (c, next) => (c.req.path.endsWith(`/platform${SIGN_IN_STEP_PATH}`) ? next() : requirePlatformAdmin(c, next)))
  .route('/', signIn)
  .route('/', tenants)
  .route('/', transfer)

export default app
