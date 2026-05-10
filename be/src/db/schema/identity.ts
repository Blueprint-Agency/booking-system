import { pgTable, uuid, text, timestamp, date, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
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
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    gender: clientGenderEnum('gender'),
    dob: date('dob'),
    status: clientStatusEnum('status').notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    referredByClientId: uuid('referred_by_client_id'),
    referralCreditGrantedAt: timestamp('referral_credit_granted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    statusIdx: index('clients_status_idx').on(table.status),
    referrerIdx: index('clients_referrer_idx').on(table.referredByClientId),
    nameIdx: index('clients_name_lower_idx').on(sql`lower(${table.name})`),
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
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clerkUserId: text('clerk_user_id').unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    role: staffRoleEnum('role').notNull(),
    status: staffStatusEnum('status').notNull().default('pending'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByStaffId: uuid('archived_by_staff_id'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    roleStatusIdx: index('staff_role_status_idx').on(table.role, table.status),
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
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    role: staffRoleEnum('role').notNull(),
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
    emailStatusIdx: index('staff_invitations_email_status_idx').on(table.email, table.status),
    inviterIdx: index('staff_invitations_inviter_idx').on(table.invitedByStaffId),
  }),
)
