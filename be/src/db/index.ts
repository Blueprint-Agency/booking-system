import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const client = postgres(url)
export const db = drizzle(client, { schema })

/** Close the Postgres connection pool — called during graceful shutdown. */
export const closeDb = () => client.end({ timeout: 5 })
