import { Hono } from 'hono'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { eq } from 'drizzle-orm'

const app = new Hono()
  .get('/locations', c => c.json({ todo: 'list active locations' }, 501))
  .get('/classes', c => c.json({ todo: 'list classes (filter location/date/instructor/type)' }, 501))
  .get('/classes/:id', c => c.json({ todo: 'class detail' }, 501))
  .get('/workshops', c => c.json({ todo: 'list workshops (filter location/date)' }, 501))
  .get('/workshops/:id', c => c.json({ todo: 'workshop detail incl. tiers + images + instructors' }, 501))
  .get('/packages', async c => {
    const [classPkgs, ptPkgs] = await Promise.all([
      db.select().from(classPackages).where(eq(classPackages.status, 'active')),
      db.select().from(ptPackages).where(eq(ptPackages.status, 'active')),
    ])
    return c.json({ classPackages: classPkgs, ptPackages: ptPkgs })
  })

export default app
