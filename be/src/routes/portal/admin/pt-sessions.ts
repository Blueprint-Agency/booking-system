import { Hono } from 'hono'

// PT request triage for admins. No "approve" or "decline" in the simplified
// flow — admin negotiates over WhatsApp, then either schedules (the implicit
// approval) or cancels. See docs/md/be-portal.md §PT.
const app = new Hono()
  // ?status=pending|scheduled|cancelled_before_scheduled|cancelled_after_scheduled|attended|all
  // Defaults to pending.
  .get('/', c => c.json({ todo: 'list pt_requests (default ?status=pending)' }, 501))
  // Admin schedules a pending request → creates pt_sessions + bookings, flips
  // status to 'scheduled'. Replaces the old POST /:id/approve.
  .post('/:id/schedule', c => c.json({ todo: 'schedule pt_request — see services/pt-sessions/schedule' }, 501))
  // Admin cancels. Branches on current status: pending → cancelled_before_scheduled (refund);
  // scheduled → cancelled_after_scheduled (no refund, cascade-cancel session + bookings).
  .post('/:id/cancel', c => c.json({ todo: 'admin cancel — see services/pt-sessions/cancel' }, 501))

export default app
