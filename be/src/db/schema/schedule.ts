import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { staffUsers, clients } from './identity'
import { instructors, classTypes, locations, rooms } from './catalog'
import { corporatePackages } from './packages'
import { lifecycleEnum, ptSessionTypeEnum, ptRequestStatusEnum, workshopInstructorRoleEnum } from '../enums'

// ============================================================================
// classes (§4e / §7b) — capacity decomposed into online/waitlist/buffer
// ============================================================================

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    classTypeId: uuid('class_type_id')
      .notNull()
      .references(() => classTypes.id, { onDelete: 'restrict' }),
    mainInstructorId: uuid('main_instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    // Nullable in DB (existing rows have none); required at the app layer for new
    // creates/reschedules. FK restrict so an in-use room can't be deleted.
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Decomposed capacity per admin-restructure.md §7d. max_capacity is derived (never stored).
    capacityOnline: integer('capacity_online').notNull(),
    capacityWaitlist: integer('capacity_waitlist').notNull().default(0),
    capacityBuffer: integer('capacity_buffer').notNull().default(0),
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
    mainInstructorStartsIdx: index('classes_main_instructor_starts_idx').on(table.mainInstructorId, table.startsAt),
    locationStartsIdx: index('classes_location_starts_idx').on(table.locationId, table.startsAt),
    roomStartsIdx: index('classes_room_starts_idx').on(table.roomId, table.startsAt),
    classTypeIdx: index('classes_class_type_idx').on(table.classTypeId),
    lifecycleStartsIdx: index('classes_lifecycle_starts_idx').on(table.lifecycle, table.startsAt),
    endsAfterStarts: check('classes_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
    capacityOnlineNonNeg: check(
      'classes_capacity_online_non_negative',
      sql`${table.capacityOnline} >= 0`,
    ),
    capacityWaitlistNonNeg: check(
      'classes_capacity_waitlist_non_negative',
      sql`${table.capacityWaitlist} >= 0`,
    ),
    capacityBufferNonNeg: check(
      'classes_capacity_buffer_non_negative',
      sql`${table.capacityBuffer} >= 0`,
    ),
    // At least one capacity slot must be > 0 — per §4e classes CHECK.
    capacitySumPositive: check(
      'classes_capacity_sum_positive',
      sql`${table.capacityOnline} + ${table.capacityWaitlist} + ${table.capacityBuffer} > 0`,
    ),
    creditNonNegative: check('classes_credit_non_negative', sql`${table.creditCost} >= 0`),
  }),
)

// ============================================================================
// class_supporting_instructors (§4.3) — 0..N per class. Main lives on classes.main_instructor_id.
// ============================================================================

export const classSupportingInstructors = pgTable(
  'class_supporting_instructors',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.classId, table.instructorId] }),
    instructorIdx: index('class_supporting_instructors_instructor_idx').on(table.instructorId),
  }),
)

// ============================================================================
// workshops (§4e / §7e / §19) — multi-day, starts_at/ends_at moved to workshop_days
// ============================================================================

export const workshops = pgTable(
  'workshops',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    coverR2Key: text('cover_r2_key'),
    descriptionHtml: text('description_html'),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
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
    locationLifecycleIdx: index('workshops_location_lifecycle_idx').on(
      table.locationId,
      table.lifecycle,
    ),
    lifecycleIdx: index('workshops_lifecycle_idx').on(table.lifecycle),
  }),
)

// ============================================================================
// workshop_days (NEW — admin-restructure.md §19, fe-client-features.md §4.1)
// One row per workshop session-day. Schedule view auto-renders one tile per row.
// ============================================================================

export const workshopDays = pgTable(
  'workshop_days',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(), // 1-based day index within the workshop
    // Room must belong to the parent workshop's location. Nullable in DB; required at app layer.
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Informational per-day reference price; actual purchase price comes from the tier.
    basePriceSgd: numeric('base_price_sgd', { precision: 10, scale: 2 }).notNull(),
    capacityOnline: integer('capacity_online').notNull(),
    capacityWaitlist: integer('capacity_waitlist').notNull().default(0),
    capacityBuffer: integer('capacity_buffer').notNull().default(0),
  },
  table => ({
    workshopOrdUnique: uniqueIndex('workshop_days_workshop_ord_unique').on(
      table.workshopId,
      table.ord,
    ),
    startsAtIdx: index('workshop_days_starts_at_idx').on(table.startsAt),
    roomStartsIdx: index('workshop_days_room_starts_idx').on(table.roomId, table.startsAt),
    endsAfterStarts: check(
      'workshop_days_ends_after_starts',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    capacityOnlineNonNeg: check(
      'workshop_days_capacity_online_non_negative',
      sql`${table.capacityOnline} >= 0`,
    ),
    capacityWaitlistNonNeg: check(
      'workshop_days_capacity_waitlist_non_negative',
      sql`${table.capacityWaitlist} >= 0`,
    ),
    capacityBufferNonNeg: check(
      'workshop_days_capacity_buffer_non_negative',
      sql`${table.capacityBuffer} >= 0`,
    ),
    capacitySumPositive: check(
      'workshop_days_capacity_sum_positive',
      sql`${table.capacityOnline} + ${table.capacityWaitlist} + ${table.capacityBuffer} > 0`,
    ),
  }),
)

// ============================================================================
// workshop_images — unchanged
// ============================================================================

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

// ============================================================================
// workshop_instructors (M:N) — unchanged
// ============================================================================

export const workshopInstructors = pgTable(
  'workshop_instructors',
  {
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'cascade' }),
    role: workshopInstructorRoleEnum('role').notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workshopId, table.instructorId] }),
    mainUnique: uniqueIndex('workshop_instructors_main_unique')
      .on(table.workshopId)
      .where(sql`role = 'main'`),
    workshopRoleIdx: index('workshop_instructors_workshop_role_idx').on(table.workshopId, table.role),
  }),
)

// ============================================================================
// workshop_tiers (§4e / §19) — capacity column REMOVED (derived via workshop_tier_days).
// Pricing uses numeric(10,2) (was text in the old schema).
// ============================================================================

export const workshopTiers = pgTable(
  'workshop_tiers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workshopId: uuid('workshop_id')
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    regularPriceSgd: numeric('regular_price_sgd', { precision: 10, scale: 2 }).notNull(),
    earlyBirdPriceSgd: numeric('early_bird_price_sgd', { precision: 10, scale: 2 }),
    earlyBirdQuota: integer('early_bird_quota'),
    earlyBirdCutoffAt: timestamp('early_bird_cutoff_at', { withTimezone: true }),
    ord: integer('ord').notNull(),
  },
  table => ({
    workshopOrdIdx: index('workshop_tiers_workshop_ord_idx').on(table.workshopId, table.ord),
  }),
)

// ============================================================================
// workshop_tier_days (NEW junction — §4e / §19)
// Which workshop_days each tier grants access to.
// ============================================================================

export const workshopTierDays = pgTable(
  'workshop_tier_days',
  {
    workshopTierId: uuid('workshop_tier_id')
      .notNull()
      .references(() => workshopTiers.id, { onDelete: 'cascade' }),
    workshopDayId: uuid('workshop_day_id')
      .notNull()
      .references(() => workshopDays.id, { onDelete: 'cascade' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.workshopTierId, table.workshopDayId] }),
    // Reverse lookup (capacity recompute on day edit).
    dayIdx: index('workshop_tier_days_day_idx').on(table.workshopDayId),
  }),
)

// ============================================================================
// pt_requests (NEW — §4e / admin-restructure.md §9 / fe-client-features.md §5.2)
// Client-submitted intent to schedule a PT session. No location_id (assigned only at scheduling).
// Workspace-agnostic (every admin sees the same triage queue).
// ----------------------------------------------------------------------------
// Circular-FK note: pt_requests.scheduled_pt_session_id → pt_sessions.id, while
// pt_sessions.pt_request_id → pt_requests.id. We forward-declare `ptSessions` as a separate
// table reference using Drizzle's `foreignKey()` constraint (declared after pt_sessions below)
// so JS module order doesn't matter. The FK is declared on `pt_requests` using a self-ref
// trick: leave `scheduled_pt_session_id` as a plain uuid column here, then add the FK in
// the table-builder `extras` after `ptSessions` is declared. Drizzle Kit will emit a
// follow-up ALTER for the FK in the generated SQL.
// ============================================================================

export const ptRequests = pgTable(
  'pt_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    preferredInstructorId: uuid('preferred_instructor_id').references(
      () => instructors.staffUserId,
      { onDelete: 'restrict' },
    ),
    preferredStartsAt: timestamp('preferred_starts_at', { withTimezone: true }).notNull(),
    preferredEndsAt: timestamp('preferred_ends_at', { withTimezone: true }).notNull(),
    sessionType: ptSessionTypeEnum('session_type').notNull(),
    coClientId: uuid('co_client_id').references(() => clients.id, { onDelete: 'restrict' }),
    message: text('message'),
    status: ptRequestStatusEnum('status').notNull().default('pending'),
    declineNote: text('decline_note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // FK to pt_sessions.id added via a separate foreignKey() declaration below to break the
    // circular reference at TS-declaration time.
    scheduledPtSessionId: uuid('scheduled_pt_session_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByStaffId: uuid('resolved_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    statusCreatedIdx: index('pt_requests_status_created_idx').on(table.status, table.createdAt),
    clientStatusIdx: index('pt_requests_client_status_idx').on(table.clientId, table.status),
    preferredInstructorStatusIdx: index('pt_requests_preferred_instructor_status_idx').on(
      table.preferredInstructorId,
      table.status,
    ),
    // Drives the expiry sweep — partial index over only `pending` rows.
    expiresAtPendingIdx: index('pt_requests_expires_at_pending_idx')
      .on(table.expiresAt)
      .where(sql`status = 'pending'`),
    endsAfterStarts: check(
      'pt_requests_preferred_ends_after_starts',
      sql`${table.preferredEndsAt} > ${table.preferredStartsAt}`,
    ),
  }),
)

// ============================================================================
// pt_sessions (reshape — §4e)
// Created only when an admin/instructor schedules a pt_requests row.
// Every session traces back to a request via pt_request_id (NOT NULL, UNIQUE).
// ============================================================================

export const ptSessions = pgTable(
  'pt_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // NOT NULL, UNIQUE — every session traces back to a request. No DB FK declared here to
    // avoid the circular FK at create time; the FK is added below via foreignKey().
    ptRequestId: uuid('pt_request_id').notNull(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    // location_id is now NOT NULL (assigned at scheduling time per §4e).
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    // Nullable in DB; required at app layer when scheduling. Must belong to location_id.
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    sessionType: ptSessionTypeEnum('session_type').notNull(),
    capacityOnline: integer('capacity_online').notNull(),
    capacityWaitlist: integer('capacity_waitlist').notNull().default(0),
    capacityBuffer: integer('capacity_buffer').notNull().default(0),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByStaffId: uuid('cancelled_by_staff_id').references(() => staffUsers.id, {
      onDelete: 'restrict',
    }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    scheduledByStaffId: uuid('scheduled_by_staff_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    instructorStartsIdx: index('pt_sessions_instructor_starts_idx').on(
      table.instructorId,
      table.startsAt,
    ),
    lifecycleStartsIdx: index('pt_sessions_lifecycle_starts_idx').on(
      table.lifecycle,
      table.startsAt,
    ),
    roomStartsIdx: index('pt_sessions_room_starts_idx').on(table.roomId, table.startsAt),
    ptRequestUnique: uniqueIndex('pt_sessions_pt_request_unique').on(table.ptRequestId),
    // Circular FK back to pt_requests.id (resolved post-table-declaration).
    ptRequestFk: foreignKey({
      columns: [table.ptRequestId],
      foreignColumns: [ptRequests.id],
      name: 'pt_sessions_pt_request_fk',
    }).onDelete('restrict'),
    endsAfterStarts: check('pt_sessions_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
    capacityOnlineNonNeg: check(
      'pt_sessions_capacity_online_non_negative',
      sql`${table.capacityOnline} >= 0`,
    ),
    capacityWaitlistNonNeg: check(
      'pt_sessions_capacity_waitlist_non_negative',
      sql`${table.capacityWaitlist} >= 0`,
    ),
    capacityBufferNonNeg: check(
      'pt_sessions_capacity_buffer_non_negative',
      sql`${table.capacityBuffer} >= 0`,
    ),
    capacitySumPositive: check(
      'pt_sessions_capacity_sum_positive',
      sql`${table.capacityOnline} + ${table.capacityWaitlist} + ${table.capacityBuffer} > 0`,
    ),
  }),
)

// NOTE: The reverse FK from pt_requests.scheduled_pt_session_id → pt_sessions.id is NOT
// declarable inside the `ptRequests` pgTable builder (the `ptSessions` symbol is not yet
// resolved at that point and forward declaration in JS module scope is messy). drizzle-kit
// 0.31.x does not currently emit an "add FK" follow-up SQL for table-level foreignKey() refs
// that are declared on the OTHER table.
//
// TODO (migration hand-edit): append the following to the generated 0001_*.sql after
// pt_sessions is created:
//
//   ALTER TABLE pt_requests
//     ADD CONSTRAINT pt_requests_scheduled_pt_session_fk
//     FOREIGN KEY (scheduled_pt_session_id)
//     REFERENCES pt_sessions(id)
//     ON DELETE SET NULL
//     DEFERRABLE INITIALLY DEFERRED;
//
// The DEFERRABLE clause lets us insert a pt_sessions row inside a transaction that also
// updates pt_requests.scheduled_pt_session_id without tripping a sequencing failure.

// ============================================================================
// pt_session_clients — unchanged (M:N supports 2-on-1)
// ============================================================================

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

// ============================================================================
// corporate_sessions (NEW — portal-only, NOT visible to fe-client)
// Pure room/instructor block; no attendee roster; no credit cost; no capacity.
// ============================================================================

export const corporateSessions = pgTable(
  'corporate_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    corporatePackageId: uuid('corporate_package_id')
      .notNull()
      .references(() => corporatePackages.id, { onDelete: 'restrict' }),
    clientName: text('client_name').notNull(),
    mainInstructorId: uuid('main_instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
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
    startsAtIdx: index('corporate_sessions_starts_at_idx').on(table.startsAt),
    instructorStartsIdx: index('corporate_sessions_instructor_starts_idx').on(
      table.mainInstructorId,
      table.startsAt,
    ),
    locationStartsIdx: index('corporate_sessions_location_starts_idx').on(
      table.locationId,
      table.startsAt,
    ),
    roomStartsIdx: index('corporate_sessions_room_starts_idx').on(table.roomId, table.startsAt),
    lifecycleStartsIdx: index('corporate_sessions_lifecycle_starts_idx').on(
      table.lifecycle,
      table.startsAt,
    ),
    endsAfterStarts: check(
      'corporate_sessions_ends_after_starts',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  }),
)

// ============================================================================
// corporate_session_supporting_instructors (§4.3) — 0..N per session.
// ============================================================================

export const corporateSessionSupportingInstructors = pgTable(
  'corporate_session_supporting_instructors',
  {
    corporateSessionId: uuid('corporate_session_id')
      .notNull()
      .references(() => corporateSessions.id, { onDelete: 'cascade' }),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.staffUserId, { onDelete: 'restrict' }),
  },
  table => ({
    pk: primaryKey({ columns: [table.corporateSessionId, table.instructorId] }),
    instructorIdx: index('corporate_session_supporting_instructors_instructor_idx').on(table.instructorId),
  }),
)
