import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenantIdColumn } from './tenancy'
import { locations } from './catalog'
import { classpassEmailKindEnum, classpassEmailOutcomeEnum } from '../enums'

/**
 * A studio's ClassPass import (#407): the private address it forwards
 * ClassPass's emails to, and whether the import is switched on.
 *
 * One row per studio, made the first time an Admin opens the ClassPass page.
 * `address_token` is the local part of the ClassPass address and the inbound
 * webhook's routing key, so it is unique across the platform, not per studio:
 * the webhook arrives with no Tenant and finds one through
 * `public.tenant_for_classpass_token` (migration 0122), because Row-Level
 * Security hides this table from a caller with no Tenant context. Regenerating
 * it replaces the value, so the old address resolves to no studio at all.
 */
export const classpassSettings = pgTable(
  'classpass_settings',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    addressToken: text('address_token').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    // The code Gmail mails a new forwarding address, shown to the Admin so
    // they can finish Gmail's verification without reading that mailbox.
    gmailConfirmationCode: text('gmail_confirmation_code'),
    gmailConfirmationAt: timestamp('gmail_confirmation_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    onePerTenant: uniqueIndex('classpass_settings_tenant_unique').on(table.tenantId),
    tokenUnique: uniqueIndex('classpass_settings_address_token_unique').on(table.addressToken),
  }),
)

/**
 * Every email that reached a studio's ClassPass address, kept with what became
 * of it, so support can say why a booking did or didn't appear and a fixed
 * parser can run again over what arrived.
 *
 * `message_id` is the email's own Message-ID, unique per studio: a webhook
 * Resend delivers twice, or a message forwarded twice, is stored once.
 * `authentication` is the receiving server's verdict (`{ spf, dkim, dmarc }`),
 * which the sender cannot forge.
 */
export const classpassInboundEmails = pgTable(
  'classpass_inbound_emails',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    messageId: text('message_id').notNull(),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    kind: classpassEmailKindEnum('kind').notNull(),
    outcome: classpassEmailOutcomeEnum('outcome').notNull(),
    authentication: jsonb('authentication'),
    headers: jsonb('headers'),
    text: text('text'),
    html: text('html'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    messageUnique: uniqueIndex('classpass_inbound_emails_message_unique').on(table.tenantId, table.messageId),
    receivedIdx: index('classpass_inbound_emails_received_idx').on(table.tenantId, table.receivedAt),
  }),
)

/**
 * A ClassPass location mapping (#410): the name ClassPass gives one of the
 * studio's locations in its emails, and the Location it means. Rows the
 * studio's Admins write on the ClassPass page; nothing is seeded.
 *
 * `location_name` is stored normalised (`normaliseClassPassLocation`,
 * `services/classpass/location-name.ts`), so two spellings that differ only in
 * case, spacing or dash characters are one row, unique per studio.
 */
export const classpassLocationMappings = pgTable(
  'classpass_location_mappings',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    locationName: text('location_name').notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    nameUnique: uniqueIndex('classpass_location_mappings_name_unique').on(table.tenantId, table.locationName),
    locationIdFkIdx: index('classpass_location_mappings_location_id_fk_idx').on(table.locationId),
  }),
)
