import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'

export const bookingTypeEnum = pgEnum('booking_type', ['class', 'workshop', 'private'])
export const bookingStatusEnum = pgEnum('booking_status', [
  'pending', 'confirmed', 'expired', 'cancelled', 'attended', 'late', 'no_show',
])

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull(),
  bookingType: bookingTypeEnum('booking_type').notNull(),
  classInstanceId: uuid('class_instance_id'),
  workshopId: uuid('workshop_id'),
  privateRequestId: uuid('private_request_id'),
  status: bookingStatusEnum('status').notNull(),
  clientPackageId: uuid('client_package_id'),
  qrCodeUrl: text('qr_code_url'),
  qrToken: text('qr_token').unique(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
