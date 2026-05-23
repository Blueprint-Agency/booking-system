import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../env'

/**
 * Single Nodemailer SMTP transport.
 *
 * Hardcoded for this project (Gmail SMTP — stable for the project's lifetime):
 *   - host:   smtp.gmail.com
 *   - port:   587 (STARTTLS)
 *   - secure: false
 *   - from:   "Yoga Sadhana <askblueprintagency@gmail.com>"
 *
 * Env-driven (because they're secrets / per-environment):
 *   - SMTP_USER     — the gmail account
 *   - SMTP_PASSWORD — the 16-char gmail App Password
 */
const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 587
const SMTP_SECURE = false
export const MAIL_FROM = 'Yoga Sadhana <askblueprintagency@gmail.com>'

export const transporter: Transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
})

/** Back-compat alias — older modules import `mailer`. */
export const mailer = transporter

export interface SendMailInput {
  to: string
  subject: string
  html: string
}

export interface SendMailResult {
  messageId: string | null
  response: string | null
}

/**
 * Thin wrapper around `transporter.sendMail` that always uses the hardcoded
 * MAIL_FROM. Throws on rejection — callers decide whether to log + swallow or
 * surface the error to the user.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const info = await transporter.sendMail({
    from: MAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  })
  const response =
    typeof info.response === 'string' ? info.response.split('\n').pop() ?? null : null
  return {
    messageId: typeof info.messageId === 'string' ? info.messageId : null,
    response,
  }
}
