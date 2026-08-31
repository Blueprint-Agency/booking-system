import type { Sql } from 'postgres'

/**
 * The role the backend connects as — and the reason Row-Level Security is a
 * control rather than a decoration.
 *
 * Postgres exempts two kinds of connection from RLS: **superusers always**, and
 * **table owners** unless the table is `FORCE`d. The role Postgres is
 * initialised with (`DB_USER`, which the deploy workflow writes into both
 * `DATABASE_URL` and `POSTGRES_USER`) is both. Point the app at it and every
 * policy in 0033 evaluates to "allowed" — while every test still passes, which
 * is what makes that mistake dangerous rather than merely wrong.
 *
 * So: migrations and seeds keep running as the owner, and the running app
 * connects as this role, which owns nothing and is explicitly NOSUPERUSER
 * NOBYPASSRLS.
 */
export const APP_ROLE = 'booking_app'

/** Single-quoted SQL literal. Only ever fed values from our own environment,
 *  but a password is one of the two things here that is not an identifier. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Create (or re-align) the application role and grant it exactly the DML it
 * needs — no DDL, no ownership, no `BYPASSRLS`.
 *
 * Run as the owner, after migrations, on every deploy: `GRANT … ON ALL TABLES`
 * only covers the tables that exist when it runs, so a migration that adds a
 * table needs this to follow it. `ALTER DEFAULT PRIVILEGES` then covers tables
 * created by *this* role afterwards, which is the belt to that braces.
 *
 * Idempotent by construction — every statement is safe to re-run, including the
 * password, which is re-set to whatever the environment currently says so a
 * rotated secret takes effect on the next deploy rather than locking the app out.
 */
export async function ensureAppRole(sql: Sql, password: string): Promise<void> {
  if (!password) throw new Error('ensureAppRole: a password is required')

  const role = APP_ROLE
  const exists = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${role}`
  if (exists.length === 0) {
    await sql.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD ${literal(password)}`)
  } else {
    await sql.unsafe(`ALTER ROLE ${role} LOGIN PASSWORD ${literal(password)}`)
  }

  // Said out loud rather than assumed. A role that picked up SUPERUSER or
  // BYPASSRLS anywhere would silently turn 0033 back into decoration.
  await sql.unsafe(`ALTER ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`)

  const [row] = await sql<{ current_database: string }[]>`SELECT current_database()`
  const database = row!.current_database
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${database.replace(/"/g, '""')}" TO ${role}`)
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`)
  await sql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  )
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`)
  // The webhook tenant-routing functions (migration 0034) and the mail-identity
  // read (migration 0036), whose EXECUTE is revoked from PUBLIC so this grant is
  // the only way in.
  await sql.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`)

  // `tenant_settings` is the one Tenant-scoped table migration 0033 leaves
  // without a policy — slug resolution reads it before any Tenant context
  // exists, so a policy keyed on the context could only refuse the request that
  // establishes it. Column privileges stand in: the app role may read the
  // branding a studio publishes to its own visitors, and nothing else. The
  // mail-from identity and the waiver text stay unreadable across tenants.
  //
  // Granted by name, not by exception, so it fails CLOSED — a column added
  // later is invisible to the app until someone decides it is public and adds
  // it here alongside `TenantDisplaySettings` in services/tenants/tenants.ts.
  //
  // The mail-from columns stay out, and the app reads them through
  // `current_tenant_mail_identity()` (migration 0036) instead — a function that
  // answers only for the tenant whose context is open, so the one read the app
  // genuinely needs cannot become a read of every studio's identity.
  await sql.unsafe(`REVOKE SELECT ON tenant_settings FROM ${role}`)
  await sql.unsafe(`
    GRANT SELECT (tenant_id, display_name, logo_url, favicon_url, og_image_url, tagline, theme, copy)
    ON tenant_settings TO ${role}
  `)
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  )
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  )
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
  )
}
