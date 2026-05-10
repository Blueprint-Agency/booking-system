import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app'
import { registerJobs } from './jobs'

const PORT = Number(process.env.PORT ?? 4000)

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`Server running on port ${info.port}`)
  registerJobs().catch(err => console.error('[jobs] failed to register:', err))
})
