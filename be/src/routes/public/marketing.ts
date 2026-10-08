import { Hono } from 'hono'
import * as svc from '../../services/marketing'
import { tenantId } from '../../middleware/tenant'

// be-client.md §marketing.ts: the studio's own public-site copy — hero,
// pricing blurb, testimonials, footer — for its member app's pages. A studio
// whose row was never written answers 200 with every field null, and the pages
// show none of it.
const app = new Hono().get('/marketing', async c =>
  c.json(svc.serializePublicMarketing(await svc.findMarketing(tenantId(c)))),
)

export default app
