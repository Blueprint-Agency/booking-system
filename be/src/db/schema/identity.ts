import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  index,
  uniqueIndex,
  unique,
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
    // The member's `client_auth_users` id. Unique per Tenant, not per platform:
    // one person may be a member of two studios, and gets an independent record
    // at each.
    authUserId: text('auth_user_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    gender: clientGenderEnum('gender'),
    dob: date('dob'),
    status: clientStatusEnum('status').notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    // Soft-delete (admin-only). When set, the row is filtered out of every
    // admin/client read path, and the member's sessions here end so they can't
    // sign in. Restore clears it. Permanent deletion is separate and removes the
    // row (`services/clients/member-delete.ts`, #144).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByStaffId: uuid('deleted_by_staff_id'),
    referredByClientId: uuid('referred_by_client_id'),
    referralCreditGrantedAt: timestamp('referral_credit_granted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    tenantAuthUserUnique: unique('clients_tenant_auth_user_unique').on(
      table.tenantId,
      table.authUserId,
    ),
    tenantEmailUnique: unique('clients_tenant_email_unique').on(table.tenantId, table.email),
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
    // The `staff_auth_users` id. Written by the invitation or seed that made the
    // row, so a pending row has one too. Unique per Tenant, not per platform: the
    // same person may be an instructor at one studio and an admin at another.
    authUserId: text('auth_user_id').notNull(),
    email: text('email').notNull(),
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
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByStaffId: uuid('archived_by_staff_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    tenantAuthUserUnique: unique('staff_users_tenant_auth_user_unique').on(
      table.tenantId,
      table.authUserId,
    ),
    tenantEmailUnique: unique('staff_users_tenant_email_unique').on(table.tenantId, table.email),
    roleStatusIdx: index('staff_role_status_idx').on(table.tenantId, table.role, table.status),
    deletedIdx: index('staff_users_deleted_idx').on(table.tenantId, table.deletedAt),
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
    // Copied onto the resulting staff_users row on accept (§4a).
    role: staffRoleEnum('role').notNull(),
    // Unique per Tenant — see `tokenUnique` below.
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    // Null for a studio's first admin, invited from the super portal: the studio
    // has no staff yet to have done the inviting, and the mail is signed by the
    // studio itself (`inviterNameFor`).
    invitedByStaffId: uuid('invited_by_staff_id').references(() => staffUsers.id, { onDelete: 'restrict' }),
    staffUserId: uuid('staff_user_id').references(() => staffUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  table => ({
    emailStatusIdx: index('staff_invitations_email_status_idx').on(table.tenantId, table.email, table.status),
    inviterIdx: index('staff_invitations_inviter_idx').on(table.tenantId, table.invitedByStaffId),
    // An invitation token is looked up inside the Tenant it was issued for, so
    // its namespace is that Tenant's. Platform-wide it was one more reason a
    // studio's archive could not be restored beside the studio it came from.
    tokenUnique: uniqueIndex('staff_invitations_token_unique').on(table.tenantId, table.token),
  }),
)
