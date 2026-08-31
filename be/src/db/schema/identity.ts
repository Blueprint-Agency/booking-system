import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenantIdColumn } from './tenancy'
import {
  clientStatusEnum,
  clientGenderEnum,
  staffRoleEnum,
  staffStatusEnum,
  invitationStatusEnum,
} from '../enums'

export const clients = pgTable(
  'clients',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    gender: clientGenderEnum('gender'),
    dob: date('dob'),
    status: clientStatusEnum('status').notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    // Soft-delete (superadmin-only). When set, the row is filtered out of every
    // admin/client read path; Clerk user is banned in parallel so the member
    // can't log in. Restore clears both. Hard erase (GDPR) is a separate Purge
    // action that anonymises PII — not implemented in this slice.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByStaffId: uuid('deleted_by_staff_id'),
    referredByClientId: uuid('referred_by_client_id'),
    referralCreditGrantedAt: timestamp('referral_credit_granted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    statusIdx: index('clients_status_idx').on(table.tenantId, table.status),
    referrerIdx: index('clients_referrer_idx').on(table.tenantId, table.referredByClientId),
    nameIdx: index('clients_name_lower_idx').on(table.tenantId, sql`lower(${table.name})`),
    deletedIdx: index('clients_deleted_idx').on(table.tenantId, table.deletedAt),
    referrerFk: foreignKey({
      columns: [table.referredByClientId],
      foreignColumns: [table.id],
      name: 'clients_referrer_fk',
    }).onDelete('set null'),
  }),
)

export const staffUsers = pgTable(
  'staff_users',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clerkUserId: text('clerk_user_id').unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    address: text('address'),
    gender: clientGenderEnum('gender'),
    bio: text('bio'),
    languages: text('languages').array().notNull().default(sql`'{}'`),
    role: staffRoleEnum('role').notNull(),
    status: staffStatusEnum('status').notNull().default('pending'),
    // Workspace grants per admin-restructure.md §15a. Empty array = "all active locations"
    // (superadmin / implicit grant). Each entry FKs locations.id at the app layer because
    // Postgres arrays cannot enforce FK. Instructor role ignores this column.
    grantedLocationIds: uuid('granted_location_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByStaffId: uuid('archived_by_staff_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    roleStatusIdx: index('staff_role_status_idx').on(table.tenantId, table.role, table.status),
    deletedIdx: index('staff_users_deleted_idx').on(table.tenantId, table.deletedAt),
    // GIN on the uuid[] column for workspace membership filters (§4a indexes).
    grantedLocationsGinIdx: index('staff_users_granted_locations_gin_idx')
      .using('gin', table.grantedLocationIds),
    archiverFk: foreignKey({
      columns: [table.archivedByStaffId],
      foreignColumns: [table.id],
      name: 'staff_archiver_fk',
    }).onDelete('restrict'),
  }),
)

export const staffInvitations = pgTable(
  'staff_invitations',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    // Role is enforced at the app layer to `admin` only in v1 — superadmin is seeded and
    // instructors are created indirectly via the /instructors route (§4a / §15a).
    role: staffRoleEnum('role').notNull(),
    // Copied onto resulting staff_users row on accept (§4a). Empty array = inherit inviter's
    // grants on accept (if inviter is superadmin → all locations).
    grantedLocationIds: uuid('granted_location_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    invitedByStaffId: uuid('invited_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    staffUserId: uuid('staff_user_id').references(() => staffUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  table => ({
    emailStatusIdx: index('staff_invitations_email_status_idx').on(table.tenantId, table.email, table.status),
    inviterIdx: index('staff_invitations_inviter_idx').on(table.tenantId, table.invitedByStaffId),
  }),
)
