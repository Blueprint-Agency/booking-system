import { env } from './env'
import { serve } from '@hono/node-server'
import app from './app'

/**
 * Node entry point. `env` is imported first to validate environment up front —
 * if anything required is missing, boot fails loudly with a Zod error report
 * before we open the HTTP socket.
 *
 * registerJobs is NOT mounted in this slice — most cron handlers depend on
 * services that aren't wired yet (refunds, email, etc.) and would throw at
 * boot. The next slice re-enables it.
 */
serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(
    JSON.stringify({
      name: 'yoga-sadhana-be',
      status: 'running',
      port: env.PORT,
      env: env.NODE_ENV,
    }),
  )
})
