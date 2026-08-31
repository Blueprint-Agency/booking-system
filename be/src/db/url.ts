import 'dotenv/config'
import { APP_ROLE } from './roles'

/**
 * Assemble a Postgres connection string from the POSTGRES_* parts, so local dev
 * has ONE source of truth for the credentials it shares with docker-compose
 * (a stale DATABASE_URL port silently connects you to someone else's database).
 * Returns null when the required parts are missing.
 */
export function buildDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = env
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return null
  return connectionString(env, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)
}

/**
 * The same database, reached as the *application* role (`booking_app`) instead
 * of the owner. This is the connection the running app uses, and the reason
 * Row-Level Security bites: the owner and any superuser bypass policies, so
 * connecting as either would leave migration 0033 as decoration.
 *
 * Local dev derives it from the same POSTGRES_* parts; deployments hand over a
 * ready-made `DATABASE_APP_URL` built from the `DB_APP_PASSWORD` secret (see
 * .github/workflows/deploy-be.yml). `DB_APP_PASSWORD` has a dev-only default so
 * `make init` keeps working out of the box — the role is created with whatever
 * this says (src/db/roles.ts), so the two cannot drift apart.
 */
export function buildAppDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const { POSTGRES_DB } = env
  if (!POSTGRES_DB) return null
  return connectionString(env, APP_ROLE, appRolePassword(env), POSTGRES_DB)
}

/**
 * The password the app role is created with and connects with — one value, so
 * provisioning and connecting can never disagree.
 *
 * The dev default keeps `make init` working with nothing configured. It does NOT
 * apply on a server: there, an unset `DB_APP_PASSWORD` returns empty and
 * `ensureAppRole` refuses to provision, which fails the migrate step with a
 * clear message instead of creating a role whose password nothing else knows.
 */
export function appRolePassword(env: NodeJS.ProcessEnv): string {
  if (env.DB_APP_PASSWORD) return env.DB_APP_PASSWORD
  // Anything a deployment sets counts as a server — `NODE_ENV` stays
  // 'production' on every one of them, and `APP_ENV` names which. Matching on
  // both means a staging box with an unset secret fails rather than quietly
  // taking a password published in this repository.
  const isDeployment =
    env.NODE_ENV === 'production' || env.APP_ENV === 'staging' || env.APP_ENV === 'production'
  return isDeployment ? '' : 'booking_app_dev'
}

function connectionString(
  env: NodeJS.ProcessEnv,
  user: string,
  password: string,
  database: string,
): string {
  const host = env.POSTGRES_HOST || 'localhost'
  const port = env.POSTGRES_PORT || '5432'
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
  return `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}`
}

// An explicit DATABASE_URL still wins — deployments hand us a ready-made one
// (see .github/workflows/deploy-be.yml).
process.env.DATABASE_URL ||= buildDatabaseUrl(process.env) ?? undefined
process.env.DATABASE_APP_URL ||= buildAppDatabaseUrl(process.env) ?? undefined
