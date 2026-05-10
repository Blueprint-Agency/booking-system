import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app'
import { registerJobs } from './jobs'

const PORT = Number(process.env.PORT ?? 4000)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(JSON.stringify({ name: 'yoga-sadhana-be', status: 'running' }))
  registerJobs().catch(() => {})
})
