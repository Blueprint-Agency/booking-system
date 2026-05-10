import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers } from './identity'
import { instructors } from './catalog'
import { classTypes, locations } from './catalog'
import { clients } from './identity'
import { lifecycleEnum, ptSessionStatusEnum, ptSessionTypeEnum } from '../enums'

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => classTypes.id, { onDelete: 'restrict' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    creditCost: integer('credit_cost').notNull(),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByStaffId: uuid('cancelled_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    startsAtIdx: index('classes_starts_at_idx').on(table.startsAt),
    instructorStartsIdx: index('classes_instructor_starts_idx').on(table.instructorId, table.startsAt),
    locationStartsIdx: index('classes_location_starts_idx').on(table.locationId, table.startsAt),
    classTypeIdx: index('classes_class_type_idx').on(table.classTypeId),
    lifecycleStartsIdx: index('classes_lifecycle_starts_idx').on(table.lifecycle, table.startsAt),
    endsAfterStarts: check('classes_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
    capacityPositive: check('classes_capacity_positive', sql`${table.capacity} > 0`),
    creditNonNegative: check('classes_credit_non_negative', sql`${table.creditCost} >= 0`),
  }),
)

export const workshops = pgTable(
  'workshops',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => classTypes.id, { onDelete: 'restrict' }),
    coverR2Key: text('cover_r2_key'),
    descriptionHtml: text('description_html'),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByStaffId: uuid('cancelled_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdByStaffId: uuid('created_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
  },
  table => ({
    startsAtIdx: index('workshops_starts_at_idx').on(table.startsAt),
    lifecycleStartsIdx: index('workshops_lifecycle_starts_idx').on(table.lifecycle, table.startsAt),
    endsAfterStarts: check('workshops_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
  }),
)

export const workshopImages = pgTable(
  'workshop_images',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    ord: integer('ord').notNull(),
  },
  table => ({
    workshopOrdIdx: index('workshop_images_workshop_ord_idx').on(table.workshopId, table.ord),
  }),
)

export const workshopInstructors = pgTable(
  'workshop_instructors',
  {
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.workshopId, table.instructorId] }),
  }),
)

export const workshopTiers = pgTable(
  'workshop_tiers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    regularPriceSgd: text('regular_price_sgd').notNull(),
    earlyBirdPriceSgd: text('early_bird_price_sgd'),
    earlyBirdQuota: integer('early_bird_quota'),
    earlyBirdCutoffAt: timestamp('early_bird_cutoff_at', { withTimezone: true }),
    capacity: integer('capacity').notNull(),
    ord: integer('ord').notNull(),
  },
  table => ({
    workshopOrdIdx: index('workshop_tiers_workshop_ord_idx').on(table.workshopId, table.ord),
    capacityPositive: check('workshop_tiers_capacity_positive', sql`${table.capacity} > 0`),
  }),
)

export const ptSessions = pgTable(
  'pt_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    sessionType: ptSessionTypeEnum('session_type').notNull(),
    status: ptSessionStatusEnum('status').notNull().default('pending'),
    declineNote: text('decline_note'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByStaffId: uuid('confirmed_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    declinedByStaffId: uuid('declined_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByStaffId: uuid('cancelled_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    instructorStartsIdx: index('pt_sessions_instructor_starts_idx').on(table.instructorId, table.startsAt),
    statusStartsIdx: index('pt_sessions_status_starts_idx').on(table.status, table.startsAt),
    endsAfterStarts: check('pt_sessions_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
  }),
)

export const ptSessionClients = pgTable(
  'pt_session_clients',
  {
    ptSessionId: uuid('pt_session_id')
      .notNull()
      .references(() => ptSessions.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.ptSessionId, table.clientId] }),
  }),
)
