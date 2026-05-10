import nodemailer from 'nodemailer'

/**
 * Single Nodemailer SMTP transport. Provider-agnostic — host/port/credentials
 * via env vars (works with AWS SES SMTP, Gmail relay, Mailgun SMTP, Postfix).
 *
 * Required env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
 *   SMTP_SECURE ('true' for 465, 'false' for 587 STARTTLS),
 *   SMTP_FROM (e.g. 'Yoga Sadhana <hello@yogasadhana.sg>')
 */
export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
})

export const MAIL_FROM = process.env.SMTP_FROM ?? 'Yoga Sadhana <noreply@example.com>'
