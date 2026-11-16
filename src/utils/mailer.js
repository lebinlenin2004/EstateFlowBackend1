import nodemailer from 'nodemailer'
import { config } from '../config/environment.js'
import { logger } from './logger.js'

export const outbox = [] // captured in tests
const transport = config.SMTP_HOST
  ? nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined })
  : null

export async function sendMail({ to, subject, text }) {
  const msg = { from: config.MAIL_FROM, to, subject, text }
  if (config.isTest) { outbox.push(msg); return }
  if (!transport) {
    if (config.isProd) logger.warn({ to, subject }, 'SMTP not configured; email not sent')
    else logger.info({ to, subject, text }, 'Email (SMTP not configured, logged instead)')
    return
  }
  try { await transport.sendMail(msg) } catch (err) { logger.error({ err, to, subject }, 'Email send failed') }
}
