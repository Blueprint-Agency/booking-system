import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { integrationTestsEnabled, SKIP_REASON, TEST_DATABASE_URL } from './harness'

/**
 * Migration 0055 (#150): the retired staff role becomes `admin`, and `staff_role`
 * stops accepting it.
 *
 * The shared scratch database is already past 0055, so this one gets a database
 * of its own: migrated up to 0054, given rows in the old role, then migrated the
 * rest of the way.
 */
describe('migration 0055: two staff roles', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  const LAST_BEFORE = 54
  const source = path.resolve(process.cwd(), 'src/db/migrations')
  const dbName = `staff_role_migration_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`

  let admin!: postgres.Sql
  let sql!: postgres.Sql
  let staged!: string

  before(async () => {
    admin = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} })
    await admin.unsafe(`CREATE DATABASE "${dbName}"`)
    const url = new URL(TEST_DATABASE_URL!)
    url.pathname = `/${dbName}`
    sql = postgres(url.toString(), { max: 1, onnotice: () => {} })

    // The migrations folder as it stood before 0055: the same SQL, a journal cut short.
    staged = mkdtempSync(path.join(tmpdir(), 'staff-role-migration-'))
    mkdirSync(path.join(staged, 'meta'))
    const journal = JSON.parse(readFileSync(path.join(source, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    journal.entries = journal.entries.filter(e => e.idx <= LAST_BEFORE)
    for (const e of journal.entries) copyFileSync(path.join(source, `${e.tag}.sql`), path.join(staged, `${e.tag}.sql`))
    writeFileSync(path.join(staged, 'meta/_journal.json'), JSON.stringify(journal))
  })

  after(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    await admin?.end()
    if (staged) rmSync(staged, { recursive: true, force: true })
  })

  test('the retired role comes out as admin, and the enum refuses it', async () => {
    await migrate(drizzle(sql), { migrationsFolder: staged })

    // Read off the enum as it stood, not spelled out here: the role's name has
    // left the codebase along with the role.
    const retired = await sql<{ label: string }[]>`
      SELECT enumlabel::text AS label FROM pg_enum
      WHERE enumtypid = 'staff_role'::regtype AND enumlabel NOT IN ('admin', 'instructor')`
    assert.equal(retired.length, 1)
    const RETIRED_ROLE = retired[0]!.label

    const tenantId = randomUUID()
    await sql`INSERT INTO tenants (id, slug, name) VALUES (${tenantId}, ${`mig-${dbName}`.slice(0, 60)}, 'Migration Studio')`
    const [staff] = await sql<{ id: string }[]>`
      INSERT INTO staff_users (tenant_id, auth_user_id, email, name, role, status, granted_location_ids)
      VALUES (${tenantId}, 'auth-old', 'old@migration.test', 'Old', ${RETIRED_ROLE}::staff_role, 'active', '{}')
      RETURNING id`
    const [teacher] = await sql<{ id: string }[]>`
      INSERT INTO staff_users (tenant_id, auth_user_id, email, name, role, status)
      VALUES (${tenantId}, 'auth-teacher', 'teacher@migration.test', 'Teacher', 'instructor', 'active')
      RETURNING id`
    await sql`
      INSERT INTO staff_invitations (tenant_id, email, role, token, expires_at)
      VALUES (${tenantId}, 'invited@migration.test', ${RETIRED_ROLE}::staff_role, 'tok', now() + interval '1 day')`

    await migrate(drizzle(sql), { migrationsFolder: source })

    const roles = await sql<{ id: string; role: string }[]>`SELECT id, role::text FROM staff_users`
    assert.equal(roles.find(r => r.id === staff!.id)?.role, 'admin')
    assert.equal(roles.find(r => r.id === teacher!.id)?.role, 'instructor')
    const [invitation] = await sql<{ role: string }[]>`SELECT role::text FROM staff_invitations`
    assert.equal(invitation?.role, 'admin')

    const [labels] = await sql<{ values: string[] }[]>`
      SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS values
      FROM pg_enum WHERE enumtypid = 'staff_role'::regtype`
    assert.deepEqual(labels?.values, ['admin', 'instructor'])
    await assert.rejects(sql`SELECT ${RETIRED_ROLE}::staff_role`)

    const grants = await sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'granted_location_ids'`
    assert.equal(grants.length, 0)
  })
})
