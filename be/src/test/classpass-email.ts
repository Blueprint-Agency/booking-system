import { randomUUID } from 'node:crypto'
import type { InboundEmail } from '../services/classpass/receive'

/**
 * A forwarded email as the ClassPass entry point receives it
 * (`receiveClassPassEmail`): the message Resend fetched, with the
 * authentication verdict of the server that received it.
 *
 * Built from the redacted samples in `docs/md/research-classpass-integration.md`,
 * in either layout ClassPass has used for its booking email: the plain-text one
 * of late 2025 (`Reservation key:` … `Reservation made by:`) and the HTML one
 * of 2026 (`Reservation ID` … `Member information`). Members are placeholders
 * and the studio is a fixture (`northwind`), never a real one.
 *
 * Every option has a default, so a test names only what it is about.
 */

export const CLASSPASS_SENDER = 'noreply@info.classpass.com'

export type ClassPassLayout = '2026-html' | '2025-text'
export type ClassPassKind = 'booking' | 'cancellation' | 'roster' | 'marketing'
export type Verdict = 'pass' | 'fail' | 'gray'

export type ClassPassEmailOptions = {
  kind?: ClassPassKind
  layout?: ClassPassLayout
  /** Resend's DKIM verdict; `null` for a message it has no authentication for. */
  dkim?: Verdict | null
  /** The From header, display name included. Defaults to ClassPass's own. */
  from?: string
  subject?: string
  /** The Message-ID: the per-Tenant dedupe key. A fresh one when not given. */
  messageId?: string
  /** 32 hex characters. */
  reservationId?: string
  className?: string
  /** As ClassPass writes it, e.g. `Northwind - Harbour`. */
  location?: string
  /** `Sep 18, 2026`. */
  date?: string
  /** `1:30 PM`. */
  time?: string
  memberName?: string
  memberEmail?: string
  /** The studio's own mailbox, which Gmail forwarding leaves on To:. */
  to?: string
  receivedAt?: Date
}

const SUBJECTS: Record<ClassPassKind, string> = {
  booking: 'ClassPass user reservation',
  cancellation: 'ClassPass reservation canceled by user',
  roster: 'ClassPass Daily Roster',
  marketing: 'You could be missing out on earnings',
}

export const newReservationId = () => randomUUID().replace(/-/g, '')

export function classPassEmail(options: ClassPassEmailOptions = {}): InboundEmail {
  const o = {
    kind: 'booking' as ClassPassKind,
    layout: '2026-html' as ClassPassLayout,
    dkim: 'pass' as Verdict | null,
    from: `ClassPass <${CLASSPASS_SENDER}>`,
    reservationId: newReservationId(),
    className: 'Yoga Stretch',
    location: 'Northwind - Harbour',
    date: 'Sep 18, 2026',
    time: '1:30 PM',
    memberName: 'Placeholder Member',
    memberEmail: 'member@classpass-member.test',
    to: 'frontdesk@northwind.test',
    ...options,
  }
  const { text, html } = body(o)
  return {
    messageId: o.messageId ?? `<${randomUUID()}@info.classpass.com>`,
    from: o.from,
    to: [o.to],
    subject: o.subject ?? SUBJECTS[o.kind],
    text,
    html,
    headers: { from: o.from, subject: o.subject ?? SUBJECTS[o.kind] },
    authentication: o.dkim === null ? null : { dkim: o.dkim, spf: 'fail', dmarc: o.dkim === 'pass' ? 'pass' : 'fail' },
    receivedAt: o.receivedAt ?? new Date(),
  }
}

type Filled = Required<Omit<ClassPassEmailOptions, 'subject' | 'messageId' | 'receivedAt'>>

function body(o: Filled): { text: string | null; html: string | null } {
  if (o.kind === 'marketing') {
    return { text: 'Partners who list more spots earn more. See your dashboard.', html: null }
  }
  if (o.kind === 'roster') {
    const text = [
      'Your Roster Recap',
      o.location.toUpperCase(),
      'Below are your ClassPass reservations for today.*',
      `  ${o.className.toUpperCase()}`,
      `  ${o.time}`,
      `  ${o.date}`,
      `  ${o.memberName}`,
    ].join('\n')
    return { text, html: null }
  }
  if (o.kind === 'cancellation') {
    const text = [
      'The following ClassPass reservation has been cancelled by the user',
      `Reservation key: ${o.reservationId}`,
      'Schedule details:',
      `  ${o.className}`,
      `  at ${o.location}`,
      `  ${o.date} @ ${o.time}`,
      'Cancelled by:',
      `  Name: ${o.memberName}`,
      `  Email: ${o.memberEmail}`,
    ].join('\n')
    return { text, html: null }
  }
  if (o.layout === '2025-text') {
    const text = [
      'You received a ClassPass reservation',
      `Reservation key: ${o.reservationId}`,
      'Reservation details:',
      `  ${o.className}`,
      `  at ${o.location}`,
      `  ${o.date} @ ${o.time}`,
      'Reservation made by:',
      `  Name: ${o.memberName}`,
      `  Email: ${o.memberEmail}`,
    ].join('\n')
    return { text, html: null }
  }
  const row = (label: string, value: string) =>
    `<tr><td style="color:#6b6b6b">${label}</td><td><strong>${value}</strong></td></tr>`
  const html = [
    '<html><body>',
    '<h1>New reservation received</h1>',
    '<p>A ClassPass member booked a spot at your business!</p>',
    '<h2>Reservation details</h2>',
    '<table>',
    row('Reservation', o.className),
    row('Date and time', `${o.date} @ ${o.time}`),
    row('Location', o.location),
    row('Reservation ID', o.reservationId),
    '</table>',
    '<h2>Member information</h2>',
    `<p>${o.memberName}</p>`,
    `<p><a href="mailto:${o.memberEmail}">${o.memberEmail}</a></p>`,
    '<p>Returning customer</p>',
    '<h2>Schedule details</h2>',
    '<table>',
    row('ClassPass reservations', '3 / 3'),
    row('Total reservations', '4 / 20'),
    '</table>',
    '<p>Data accurate at time of email send</p>',
    '</body></html>',
  ].join('\n')
  return { text: null, html }
}

export type RosterClass = {
  /** As ClassPass prints it: in capitals, `YOGA STRETCH`. */
  className: string
  /** `01:30pm`. */
  time: string
  /** `Fri, Sep 18`: no year. */
  day: string
  members: string[]
}

export type ClassPassRosterOptions = {
  /** The listing's header, `NORTHWIND - HARBOUR`, or cut short as `NORTHWIND -`. */
  location?: string
  classes?: RosterClass[]
  dkim?: Verdict | null
  messageId?: string
  receivedAt?: Date
  /** The roster as ClassPass's HTML, rather than plain text. */
  html?: boolean
}

/**
 * A `ClassPass Daily Roster` email for one ClassPass listing, laid out as the
 * redacted sample in `research-classpass-integration.md`: the listing's name,
 * then each class with its time, its day (no year) and the names of the
 * members coming. Names only: no emails, no reservation IDs.
 */
export function classPassRoster(options: ClassPassRosterOptions = {}): InboundEmail {
  const location = options.location ?? 'NORTHWIND - HARBOUR'
  const classes = options.classes ?? []
  const receivedAt = options.receivedAt ?? new Date()
  const dkim = options.dkim === undefined ? 'pass' : options.dkim
  const from = `ClassPass <${CLASSPASS_SENDER}>`
  const subject = SUBJECTS.roster
  const today = `${String(receivedAt.getUTCMonth() + 1).padStart(2, '0')}/${String(receivedAt.getUTCDate()).padStart(2, '0')}`
  const lines = [
    'Your Roster Recap',
    location,
    `Below are your ClassPass reservations for today, ${today}.*`,
    ...classes.flatMap(c => [`  ${c.className}`, `  ${c.time}`, `  ${c.day}`, ...c.members.map(m => `  ${m}`)]),
    '*Reservations are accurate as of the time this email was sent.',
  ]
  const html = options.html
    ? [
        '<html><body>',
        '<h1>Your Roster Recap</h1>',
        `<h2>${location}</h2>`,
        `<p>Below are your ClassPass reservations for today, ${today}.*</p>`,
        ...classes.map(
          c =>
            `<table><tr><td><strong>${c.className}</strong></td></tr><tr><td>${c.time}</td></tr><tr><td>${c.day}</td></tr>` +
            c.members.map(m => `<tr><td>${m}</td></tr>`).join('') +
            '</table>',
        ),
        '<p>*Reservations are accurate as of the time this email was sent.</p>',
        '</body></html>',
      ].join('\n')
    : null
  return {
    messageId: options.messageId ?? `<${randomUUID()}@info.classpass.com>`,
    from,
    to: ['frontdesk@northwind.test'],
    subject,
    text: options.html ? null : lines.join('\n'),
    html,
    headers: { from, subject },
    authentication: dkim === null ? null : { dkim, spf: 'fail', dmarc: dkim === 'pass' ? 'pass' : 'fail' },
    receivedAt,
  }
}

/**
 * The email Gmail sends a new forwarding address, asking the mailbox's owner
 * to confirm it. Its code is what the Admin types back into Gmail.
 */
export function gmailForwardingConfirmation(
  options: { code?: string; owner?: string; dkim?: Verdict | null; from?: string; messageId?: string } = {},
): InboundEmail {
  const code = options.code ?? '493017286'
  const owner = options.owner ?? 'frontdesk@northwind.test'
  const from = options.from ?? 'Gmail Team <forwarding-noreply@google.com>'
  const dkim = options.dkim === undefined ? 'pass' : options.dkim
  const subject = `(#${code}) Gmail Forwarding Confirmation - Receive Mail from ${owner}`
  const text = [
    `${owner} has requested to automatically forward mail to your email address.`,
    `Confirmation code: ${code}`,
    '',
    'To allow this, please click the link below to confirm the request.',
  ].join('\n')
  return {
    messageId: options.messageId ?? `<${randomUUID()}@google.com>`,
    from,
    to: [owner],
    subject,
    text,
    html: null,
    headers: { from, subject },
    authentication: dkim === null ? null : { dkim, spf: 'pass', dmarc: dkim === 'pass' ? 'pass' : 'fail' },
    receivedAt: new Date(),
  }
}
