import { z } from 'zod'
import { nonEmpty } from './common.js'

const text = (max = 120) => z.string().trim().max(max)
export const addressSchema = z.object({ line1: text(), city: text(), state: text(), country: text(), postalCode: text(20) }).partial().strict()
const timezone = z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }, 'Unknown timezone')
const bool = z.boolean()

export const updateOrganizationSchema = { body: z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email(), phone: text(20),
  website: z.string().trim().url('Enter a full URL starting with https://').max(200), registrationNumber: text(60), address: addressSchema,
}).partial().strict().refine(nonEmpty, 'Provide at least one field') }

export const updateSettingsSchema = { body: z.object({
  currency: z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP']), timezone, dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  visitDurationMinutes: z.number().int().min(15).max(480), leadAutoAssign: bool,
  notifications: z.object({ email: bool, inApp: bool, followUpReminders: bool, siteVisitReminders: bool, agreementExpiryAlerts: bool, rentPaymentReminders: bool }).partial().strict(),
}).partial().strict().refine(nonEmpty, 'Provide at least one setting') }
