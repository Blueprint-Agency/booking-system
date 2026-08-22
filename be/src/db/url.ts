import 'dotenv/config'

/**
 * Assemble a Postgres connection string from the POSTGRES_* parts, so local dev
 * has ONE source of truth for the credentials it shares with docker-compose
 * (a stale DATABASE_URL port silently connects you to someone else's database).
 * Returns null when the required parts are missing.
 */
export function buildDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = env
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return null
  const host = env.POSTGRES_HOST || 'localhost'
  const port = env.POSTGRES_PORT || '5432'
  const auth = `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}`
  return `postgres://${auth}@${host}:${port}/${encodeURIComponent(POSTGRES_DB)}`
}

// An explicit DATABASE_URL still wins — deployments hand us a ready-made one
// (see .github/workflows/deploy-be.yml).
process.env.DATABASE_URL ||= buildDatabaseUrl(process.env) ?? undefined
