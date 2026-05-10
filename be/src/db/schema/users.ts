import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['client', 'instructor', 'studio_admin', 'super_admin'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').unique().notNull(),
  phone: text('phone'),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const clients = pgTable('clients', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  waiverSignedAt: timestamp('waiver_signed_at', { withTimezone: true }),
  waiverVersion: text('waiver_version'),
  waiverResetAt: timestamp('waiver_reset_at', { withTimezone: true }),
  locationPref: uuid('location_pref'),
  referralCode: text('referral_code').unique(),
  referredBy: uuid('referred_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const instructors = pgTable('instructors', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  bio: text('bio'),
  photoUrl: text('photo_url'),
  privateRate: text('private_rate'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
