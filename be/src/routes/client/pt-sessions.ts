import { Hono } from 'hono'
import { requireVerified } from '../../middleware/clerk-client'

// Client-side PT request endpoints. See docs/md/be-client.md §PT.
//   GET    /                    list own pt_requests (incl. scheduled pt_sessions detail)
//   POST   /request             submit a new pt_request (debits package on submit)
//   POST   /:id/cancel          cancel own request:
//                                 pending   → cancelled_before_scheduled (refund)
//                                 scheduled → cancelled_after_scheduled (no refund v1)
//   GET    /partner-lookup?email=…  exact-match email lookup for 2on1 partner autocomplete
//                                   (returns {found: boolean, clientId?: string, name?: string})
const app = new Hono()
  .get('/', c => c.json({ todo: 'list own PT requests + scheduled sessions' }, 501))
  .get('/partner-lookup', requireVerified, c => c.json({ todo: 'exact-match partner email lookup for 2on1' }, 501))
  .post('/request', requireVerified, c => c.json({ todo: 'submit PT request — see services/pt-sessions/request' }, 501))
  .post('/:id/cancel', requireVerified, c => c.json({ todo: 'client cancel — see services/pt-sessions/cancel' }, 501))

export default app
