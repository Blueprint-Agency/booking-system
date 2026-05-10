import express from 'express'
import { sql } from 'drizzle-orm'
import { db } from './db'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import webhookRouter from './routes/webhooks'
import publicRouter from './routes/public'
import clientRouter from './routes/client'
import instructorRouter from './routes/instructor'
import adminRouter from './routes/admin'
import superRouter from './routes/super'

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }))

// Webhook routes need raw body — register before json parser
app.use('/api/v1', webhookRouter)

app.use(express.json())

app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`)
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() })
  }
})


const publicLimiter = rateLimit({ windowMs: 60_000, max: 100 })
const authedLimiter = rateLimit({ windowMs: 60_000, max: 300 })

app.use('/api/v1', publicLimiter, publicRouter)
app.use('/api/v1', authedLimiter, clientRouter)
app.use('/api/v1', authedLimiter, instructorRouter)
app.use('/api/v1', authedLimiter, adminRouter)
app.use('/api/v1', authedLimiter, superRouter)

export default app
