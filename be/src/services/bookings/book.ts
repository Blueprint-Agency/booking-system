/**
 * Class booking: capacity check + credit deduct in a single transaction.
 * See be-client.md §4a.
 *
 * A member (`bookClass`) and staff booking a member (`staffBookClass`) are the
 * same booking; they differ only in which seat they may take, which is
 * `./seats` (spec-waitlist.md §2).
 *
 * Which package pays is `services/packages/selection` — a pure module, so the
 * Location, ordering and prospective-expiry rules are testable without a
 * database. This file loads rows, locks them, and writes what it is told.
 *
 * Concurrency: the class row is locked FOR UPDATE so concurrent bookings for the
 * same class serialise (capacity + double-book checks are race-safe); the
 * client's package rows are locked too so a double-click can't double-debit —
 * and so a Dormant package has exactly one writer at Activation.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { clients } from '../../db/schema/identity'
import { classPackages, clientPackages } from '../../db/schema/packages'
import { locations } from '../../db/schema/catalog'
import type { BookingSeat } from '../../db/enums'
import { generateBookingCodes } from './qr'
import { countSeats, seatFor, type SeatRole } from './seats'
import type { Tx } from '../schedule/roster'
import { debitCredits } from '../packages/ledger'
import { activatePackage, sweepExpired } from '../packages/activation'
import { classifyPackages, selectPackage, type CandidatePackage, type SelectionRefusal } from '../packages/selection'
import { lineState, settleWaitingOnBooking } from '../waitlist/line'
import { clashError, lockMemberTime, memberClash, type HeldWindow } from './member-time'
import { readClassRule } from '../schedule/package-rules'
import type { PackageRuleMode } from '../../db/enums'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'

export interface BookClassInput {
  clientId: string
  classId: string
  /**
   * The package the member picked on the Book sheet — the one piece of client
   * input selection accepts. Absent, the Default payer pays (be/docs/adr/0010).
   */
  clientPackageId?: string | null
}

/** The package that paid for a booking, named for the member or staff who made it. */
export interface PaidWith {
  id: string
  name: string
  kind: CandidateKind
}

export interface BookClassResult {
  bookingId: string
  qrToken: string
  code: string
  seat: BookingSeat
  paidWith: PaidWith
}

/** A member booking themselves: an online seat or nothing. */
export async function bookClass(
  tenantId: string,
  input: BookClassInput,
): Promise<BookClassResult> {
  return bookIntoClass(tenantId, { ...input, role: 'member', overbook: false })
}

export interface StaffBookClassInput {
  clientId: string
  classId: string
  role: Exclude<SeatRole, 'member'>
  /** The staff member booking. An instructor may only book onto a class they teach. */
  actorStaffId: string
  /** Admin only: take an overbook seat when the buffer is full. Ignored for instructors. */
  overbook?: boolean
  /**
   * Staff's "Book anyway": book the member although they already hold a
   * booking at an overlapping time, having been shown it (`time_clash`).
   */
  allowClash?: boolean
  /**
   * The package staff picked for the member, as the member would on the Book
   * sheet (#333): refused with its own reason unless it is Eligible. Absent,
   * the Default payer pays.
   */
  clientPackageId?: string | null
}

/**
 * Staff booking a member onto a class (spec-waitlist.md §7): a buffer seat, or
 * an overbook seat for an admin who asked. Everything else — package selection
 * (staff's pick or the Default payer), the debit, Activation, the QR code — is
 * the member's booking, unchanged.
 */
export async function staffBookClass(
  tenantId: string,
  input: StaffBookClassInput,
): Promise<BookClassResult> {
  return bookIntoClass(tenantId, {
    clientId: input.clientId,
    classId: input.classId,
    role: input.role,
    overbook: input.overbook ?? false,
    allowClash: input.allowClash ?? false,
    actorStaffId: input.actorStaffId,
    clientPackageId: input.clientPackageId ?? null,
  })
}

async function bookIntoClass(
  tenantId: string,
  input: BookClassInput & { role: SeatRole; overbook: boolean; allowClash?: boolean; actorStaffId?: string },
): Promise<BookClassResult> {
  const { clientId, classId } = input

  // One instant for the whole booking: the started check, the expiry sweep,
  // selection and the Activation stamp all agree on what "now" is.
  const now = clockNow()

  return db.transaction(async tx => {
    // 1. Lock the class row so capacity is evaluated race-free.
    const cls = await lockClass(tx, tenantId, classId)

    if (!cls || cls.lifecycle !== 'active') throw new NotFoundError('class_not_found')
    assertStaffReaches(cls, input.role, input.actorStaffId)
    if (cls.startsAt <= now) throw new BadRequestError('class_already_started')

    // A member booked by staff must be one of this studio's members. RLS would
    // refuse the insert anyway; this makes it a 404 rather than a 500.
    if (input.role !== 'member') await assertStudioMember(tx, tenantId, clientId)

    // 2. Already booked? (one confirmed booking per client per class)
    if (await holdsSeat(tx, tenantId, clientId, classId)) throw new ConflictError('already_booked')

    // 3. Which seat — counted under the class lock, decided by the seat rules.
    const counts = await countSeats(tx, tenantId, classId)
    const decision = seatFor(counts, cls, input.role, input.overbook)
    if (!decision.ok) {
      // The waitlist fields let the caller offer the queue instead. A member
      // learns only whether it is open; its length and cap are for staff.
      const line = await lineState(tx, tenantId, cls, now)
      throw new ConflictError(
        'class_full',
        input.role === 'member'
          ? { waitlist_open: line.open }
          : { waitlist_open: line.open, waiting: line.waiting, capacity_waitlist: cls.capacityWaitlist },
      )
    }

    // 4–5. Pay and book.
    const paid = await payAndBook(tx, tenantId, cls, {
      clientId,
      seat: decision.seat,
      clientPackageId: input.clientPackageId ?? null,
      // A member is never let through a clash; staff only once they were warned.
      allowClash: input.role !== 'member' && (input.allowClash ?? false),
      now,
    })
    if (!paid.ok) throw await refusalError(tx, tenantId, clientId, paid)

    // Booked by hand while waiting in the line: the place in it is spent.
    await settleWaitingOnBooking(tx, tenantId, {
      classId,
      clientId,
      by: input.role === 'member' ? 'client' : input.actorStaffId!,
      now,
    })

    return paid.booking
  })
}

/** An instructor reaches their own classes only — the same rule as check-in. */
function assertStaffReaches(cls: { mainInstructorId: string }, role: SeatRole, actorStaffId?: string) {
  if (role === 'instructor' && cls.mainInstructorId !== actorStaffId) {
    throw new ForbiddenError('not_your_session', { message: 'This class is not one you are teaching.' })
  }
}

/** The member staff act for is one of this studio's, not deleted: `client_not_found` otherwise. */
async function assertStudioMember(reader: Tx | typeof db, tenantId: string, clientId: string) {
  const [client] = await reader
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1)
  if (!client) throw new NotFoundError('client_not_found')
}

/** The class row a booking reads, as `lockClass` returns it. */
export interface LockedClass {
  id: string
  locationId: string
  startsAt: Date
  endsAt: Date
  capacityOnline: number
  capacityBuffer: number
  capacityWaitlist: number
  creditCost: number
  lifecycle: string
  mainInstructorId: string
  /** The class's own Cancellation Window; null = the studio's (policy/cancel-window.ts). */
  cancelWindowHours: number | null
  /** The class's Package rule mode; its list is read by `readClassRule` when it has one. */
  packageRuleMode: PackageRuleMode
}

/**
 * Lock a class row `FOR UPDATE` and read what booking needs. Every writer of a
 * class's seats or line — booking, cancel, the waitlist — takes this lock first,
 * so they serialise per class.
 */
export async function lockClass(tx: Tx, tenantId: string, classId: string): Promise<LockedClass | undefined> {
  const [cls] = await tx
    .select({
      id: classes.id,
      locationId: classes.locationId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      capacityOnline: classes.capacityOnline,
      capacityBuffer: classes.capacityBuffer,
      capacityWaitlist: classes.capacityWaitlist,
      creditCost: classes.creditCost,
      lifecycle: classes.lifecycle,
      mainInstructorId: classes.mainInstructorId,
      cancelWindowHours: classes.cancelWindowHours,
      packageRuleMode: classes.packageRuleMode,
    })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, classId)))
    .for('update')
    .limit(1)
  return cls
}

/** Whether the member already holds a confirmed booking on the class — one per member per class. */
export async function holdsSeat(tx: Tx, tenantId: string, clientId: string, classId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, clientId),
        eq(bookings.classId, classId),
        eq(bookings.state, 'confirmed'),
      ),
    )
    .limit(1)
  return !!row
}

type CandidateKind = CandidatePackage['kind']

const KIND_NAME: Record<CandidateKind, string> = {
  credit_bundle: 'Credit bundle',
  unlimited: 'Unlimited',
  trial: 'Trial pass',
  pt: 'PT package',
}

/** A package as a member reads it: its catalogue name, or its kind when it has none. */
export function packageDisplayName(kind: CandidateKind, catalogueName: string | null): string {
  return catalogueName ?? KIND_NAME[kind]
}

/** `paid_with` as the member's and the staff booking responses both carry it. */
export function serializePaidWith(p: PaidWith) {
  return { client_package_id: p.id, name: p.name, kind: p.kind }
}

/**
 * The member's packages that could pay for a class, as selection reads them,
 * with the catalogue name the Book sheet and staff are shown. Add
 * `.for('update', { of: clientPackages })` when about to spend one — Postgres
 * refuses to lock the nullable side of the outer join.
 */
export function candidatePackages(reader: Tx | typeof db, tenantId: string, clientId: string) {
  return reader
    .select({
      id: clientPackages.id,
      kind: clientPackages.kind,
      sourceClassPackageId: clientPackages.sourceClassPackageId,
      creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
      expiresAt: clientPackages.expiresAt,
      locationId: clientPackages.locationId,
      durationMonths: clientPackages.durationMonths,
      validityDays: clientPackages.validityDays,
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
      purchasedAt: clientPackages.purchasedAt,
      catalogueName: classPackages.name,
    })
    .from(clientPackages)
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .where(
      and(
        // The credit-isolation rule, at the one place credits are chosen to be
        // spent: a plan sold by another studio is not a candidate here.
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.active, true),
      ),
    )
}

export type PayAndBookResult =
  | { ok: true; booking: BookClassResult }
  | { ok: false; refusal: SelectionRefusal }
  | { ok: false; refusal: 'time_clash'; clash: HeldWindow }

/** The 409 a refused `payAndBook` becomes for a caller booking by hand. */
export async function refusalError(
  reader: Tx | typeof db,
  tenantId: string,
  clientId: string,
  paid: Extract<PayAndBookResult, { ok: false }>,
) {
  return 'clash' in paid ? clashError(reader, tenantId, clientId, paid.clash) : new ConflictError(paid.refusal)
}

/**
 * Pay for a seat on a class the caller has locked, and insert the booking:
 * package selection, the debit, Activation, the QR code. The one booking path —
 * a member, staff and a waitlist promotion all come through here, so a promoted
 * booking is paid for exactly as if the member had booked it by hand.
 *
 * The member must be free for the class's whole time (./member-time): a
 * booking at an overlapping time refuses it `time_clash` unless staff allowed it.
 *
 * A package that cannot pay, or a clash, is returned, not thrown, so a
 * promotion can skip to the next member in line inside the same transaction.
 * Nothing has been written by then except the expiry sweep, which is the
 * nightly job's own write early.
 */
export async function payAndBook(
  tx: Tx,
  tenantId: string,
  cls: LockedClass,
  input: {
    clientId: string
    seat: BookingSeat
    /** The member's or staff's pick; null where nobody picked, and the Default payer pays. */
    clientPackageId: string | null
    /** Staff were shown the member's clash and booked anyway. */
    allowClash?: boolean
    now: Date
  },
): Promise<PayAndBookResult> {
  const { clientId, now } = input

  // One body, one class at a time. Held from here to commit, so a second
  // booking for this member made at the same moment sees this one.
  await lockMemberTime(tx, tenantId, [clientId])
  if (!input.allowClash) {
    const clash = await memberClash(
      tx,
      tenantId,
      clientId,
      { startsAt: cls.startsAt, endsAt: cls.endsAt },
      { kind: 'class', id: cls.id },
    )
    if (clash) return { ok: false, refusal: 'time_clash', clash }
  }

  // Pick a package to pay with (lock the client's rows).
  // A package whose expiry has passed since the nightly sweep still says
  // `active`. Sweep the member's own rows first so the rows read below are the
  // ones the cron would leave — the same flip it does, a day early.
  await sweepExpired(tx, tenantId, clientId, now)
  const pkgs = await candidatePackages(tx, tenantId, clientId).for('update', { of: clientPackages })

  const choice = selectPackage({
    packages: pkgs,
    classLocationId: cls.locationId,
    classStartsAt: cls.startsAt,
    creditCost: cls.creditCost,
    rule: await readClassRule(tx, tenantId, cls),
    clientPackageId: input.clientPackageId,
    now,
  })
  if (!choice.ok) {
    // Another member's package, a PT package, or one already spent: not one of
    // this member's to pay with, whatever id the client sent.
    if (choice.refusal === 'client_package_not_found') throw new NotFoundError('client_package_not_found')
    return { ok: false, refusal: choice.refusal }
  }

  const { clientPackageId, creditsUsed } = choice
  const payer = pkgs.find(p => p.id === clientPackageId)!

  if (creditsUsed > 0) {
    // The ledger re-derives `active` — a bundle spent to exactly zero stops
    // being a booking candidate immediately, not at the nightly sweep.
    await debitCredits(tx, {
      tenantId,
      clientId,
      clientPackageId,
      amount: creditsUsed,
      reason: 'class_booking_debit',
      // See ledger.ts — booking debits stay out of the admin adjustments panel.
      audit: false,
    })
  }

  // Activation (§3): the first confirmed class booking a Dormant package pays
  // for starts its clock, stamped here because this transaction already holds
  // the row locked — one writer, no race. One-way: no cancellation un-stamps it.
  // Other packages of the Family may be running beside it (ADR 0010).
  if (choice.activateUntil) {
    await activatePackage(tx, tenantId, clientPackageId, choice.activateUntil)
  }

  // Create the booking.
  const { qrToken, code } = generateBookingCodes()
  const [row] = await tx
    .insert(bookings)
    .values({
      tenantId,
      clientId,
      kind: 'class',
      classId: cls.id,
      clientPackageId,
      state: 'confirmed',
      seat: input.seat,
      creditsOrSessionsUsed: creditsUsed,
      qrToken,
      code,
    })
    .returning({ id: bookings.id })

  return {
    ok: true,
    booking: {
      bookingId: row!.id,
      qrToken,
      code,
      seat: input.seat,
      paidWith: { id: payer.id, name: packageDisplayName(payer.kind, payer.catalogueName), kind: payer.kind },
    },
  }
}

/** One of the member's class packages, read against one class for the Book sheet. */
export interface MemberPackageForClass {
  id: string
  name: string
  kind: CandidateKind
  /** Activated: its clock is running. False means Dormant. */
  running: boolean
  /** Credits left; null on an Unlimited Plan. */
  remaining: number | null
  expiresAt: Date | null
  /** Dormant only: the end date picking it for this class would stamp. */
  activationEndIfPicked: Date | null
  /** Home Location of an Unlimited Plan, for "Covers {Location} only". */
  location: { id: string; name: string } | null
  eligible: boolean
  reason: SelectionRefusal | null
}

/**
 * Every live class package the member holds, each Eligible for this class or
 * with the reason it is not, in default order — so the first Eligible row IS
 * the Default payer the Book sheet pre-selects. Read-only: no sweep, no lock.
 * Null when the class is not bookable.
 */
export async function memberPackagesForClass(
  tenantId: string,
  clientId: string,
  classId: string,
): Promise<MemberPackagesForClass | null> {
  const cls = await readBookableClass(tenantId, classId)
  if (!cls) return null
  return classifyForClass(tenantId, clientId, cls)
}

/**
 * The same read for staff about to book a member (#333) — what the roster's
 * package select lists. A member of another studio is `client_not_found`, and
 * an instructor reads only a class they teach, as they book only onto one.
 */
export async function staffPackagesForClass(
  tenantId: string,
  input: Omit<StaffBookClassInput, 'overbook' | 'clientPackageId'>,
): Promise<MemberPackagesForClass> {
  const cls = await readBookableClass(tenantId, input.classId)
  if (!cls) throw new NotFoundError('class_not_found')
  assertStaffReaches(cls, input.role, input.actorStaffId)
  await assertStudioMember(db, tenantId, input.clientId)
  return classifyForClass(tenantId, input.clientId, cls)
}

export interface MemberPackagesForClass {
  packages: MemberPackageForClass[]
  /** The first Eligible package — what pays when nobody picks. */
  defaultPayerId: string | null
}

type BookableClass = NonNullable<Awaited<ReturnType<typeof readBookableClass>>>

/** A class as the package reads need it; null unless it is still running. */
async function readBookableClass(tenantId: string, classId: string) {
  const [cls] = await db
    .select({
      id: classes.id,
      locationId: classes.locationId,
      startsAt: classes.startsAt,
      creditCost: classes.creditCost,
      lifecycle: classes.lifecycle,
      packageRuleMode: classes.packageRuleMode,
      mainInstructorId: classes.mainInstructorId,
    })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, classId)))
    .limit(1)
  return cls && cls.lifecycle === 'active' ? cls : null
}

async function classifyForClass(tenantId: string, clientId: string, cls: BookableClass): Promise<MemberPackagesForClass> {
  const now = clockNow()
  const pkgs = await candidatePackages(db, tenantId, clientId)
  const locationIds = [...new Set(pkgs.flatMap(p => (p.locationId ? [p.locationId] : [])))]
  const locationNames = new Map(
    locationIds.length === 0
      ? []
      : (
          await db
            .select({ id: locations.id, name: locations.name })
            .from(locations)
            .where(and(eq(locations.tenantId, tenantId), inArray(locations.id, locationIds)))
        ).map(l => [l.id, l.name] as const),
  )

  const classified = classifyPackages({
    packages: pkgs,
    classLocationId: cls.locationId,
    classStartsAt: cls.startsAt,
    creditCost: cls.creditCost,
    rule: await readClassRule(db, tenantId, cls),
    now,
  })
  const packages = classified.map(({ pkg, running, reason, activateUntil }) => {
    const p = pkgs.find(x => x.id === pkg.id)!
    return {
      id: p.id,
      name: packageDisplayName(p.kind, p.catalogueName),
      kind: p.kind,
      running,
      remaining: p.kind === 'unlimited' ? null : p.creditsOrSessionsRemaining,
      expiresAt: p.expiresAt,
      activationEndIfPicked: activateUntil,
      location: p.locationId ? { id: p.locationId, name: locationNames.get(p.locationId) ?? 'another studio' } : null,
      eligible: reason === null,
      reason,
    }
  })
  return { packages, defaultPayerId: packages.find(p => p.eligible)?.id ?? null }
}

/** One classified package as the member's Book sheet and the staff roster both read it. */
export function serializeMemberPackageForClass(p: MemberPackageForClass) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    running: p.running,
    remaining: p.remaining,
    expires_at: p.expiresAt?.toISOString() ?? null,
    activation_end_if_picked: p.activationEndIfPicked?.toISOString() ?? null,
    location: p.location,
    eligible: p.eligible,
    reason: p.reason,
  }
}
