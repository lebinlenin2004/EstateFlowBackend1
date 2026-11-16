import { z } from 'zod'
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCES, MANUAL_ACTIVITY_TYPES, FOLLOWUP_TYPES, VISIT_STATUSES } from '../constants/crm.js'
import { PROPERTY_TYPES, LISTING_TYPES } from '../constants/property.js'
import { objectId, pagination, nonEmpty } from './common.js'
import { money } from './property.validators.js'
import { normalizePhone, isValidPhone } from '../utils/phone.js'

const str = (max) => z.string().trim().max(max)
const phone = z.string().transform(normalizePhone).refine(isValidPhone, 'Enter a valid phone number (7-15 digits)')
// ISO 8601 with a timezone offset, e.g. 2026-11-20T10:00:00+05:30 or ...Z
const instant = z.string().datetime({ offset: true, message: 'Use ISO format with a timezone, e.g. 2026-11-20T10:00:00+05:30' }).transform((s) => new Date(s))
const rangeDate = z.coerce.date()
const csv = (allowed) => z.string().max(200).optional().transform((s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : undefined))
  .refine((a) => !a || a.every((v) => allowed.includes(v)), 'Unknown value in list')
const flag = z.enum(['true', 'false']).optional().transform((v) => v === 'true')
const budget = z.object({ min: money.optional(), max: money.optional() }).strict().refine((b) => !(b.min && b.max) || b.min <= b.max, 'Minimum budget cannot exceed maximum')

// ---------- leads
const leadFields = {
  title: str(150).min(3), source: z.enum(LEAD_SOURCES), requirements: str(2000), budget, preferredLocations: z.array(str(80).min(1)).max(10),
  propertyType: z.enum(PROPERTY_TYPES), interestedPropertyIds: z.array(objectId).max(10), priority: z.enum(LEAD_PRIORITIES),
}
const { priority: _p, ...leadFieldsNoPriority } = leadFields
const contact = z.object({ name: str(100).min(2), phone, email: z.string().trim().toLowerCase().email().optional() }).strict()
export const createLeadSchema = { body: z.object({ ...leadFields, customerId: objectId, contact, assignedAgentId: objectId, notes: str(1000) }).partial().strict()
  .refine((v) => !!v.customerId !== !!v.contact, 'Provide either customerId or contact details (name and phone), not both') }
export const updateLeadSchema = { body: z.object(leadFieldsNoPriority).partial().strict().refine(nonEmpty, 'Provide at least one field') }
export const leadStatusSchema = { body: z.object({ status: z.enum(LEAD_STATUSES).refine((s) => s !== 'converted', 'Use the convert action to close a lead as converted'), lostReason: str(300).optional() })
  .refine((v) => v.status !== 'lost' || !!v.lostReason, { message: 'A lost reason is required', path: ['lostReason'] }) }
export const leadPrioritySchema = { body: z.object({ priority: z.enum(LEAD_PRIORITIES) }) }
export const leadAssignSchema = { body: z.object({ agentId: objectId.nullable() }) }
export const activitySchema = { body: z.object({ type: z.enum(MANUAL_ACTIVITY_TYPES), summary: str(1000).min(1) }) }
export const convertSchema = { body: z.object({ propertyId: objectId.optional(), dealValue: money, dealType: z.enum(LISTING_TYPES).optional(), closedAt: instant.optional() })
  .refine((v) => v.propertyId || v.dealType, { message: 'Provide a property or a deal type', path: ['dealType'] }) }
const LEAD_SORT = z.enum(['newest', 'oldest', 'activity']).default('newest')
const leadFilters = { search: str(100).optional(), priority: z.enum(LEAD_PRIORITIES).optional(), source: z.enum(LEAD_SOURCES).optional(), propertyType: z.enum(PROPERTY_TYPES).optional(),
  assignedAgent: objectId.optional(), unassigned: flag, customerId: objectId.optional(), createdFrom: rangeDate.optional(), createdTo: rangeDate.optional(), archived: flag }
export const listLeadsSchema = { query: z.object({ ...pagination, ...leadFilters, status: csv(LEAD_STATUSES), sort: LEAD_SORT }) }
export const pipelineSchema = { query: z.object({ ...leadFilters, perStage: z.coerce.number().int().min(1).max(50).default(20) }) }
export const leadStatsSchema = { query: z.object({ assignedAgent: objectId.optional() }) }
export const activitiesSchema = { query: z.object({ ...pagination }) }

// ---------- follow-ups
export const createFollowUpSchema = { body: z.object({ leadId: objectId, dueAt: instant, type: z.enum(FOLLOWUP_TYPES).default('call'), priority: z.enum(LEAD_PRIORITIES).default('medium'),
  notes: str(1000).optional(), assignedAgentId: objectId.optional() }) }
export const updateFollowUpSchema = { body: z.object({ dueAt: instant, type: z.enum(FOLLOWUP_TYPES), priority: z.enum(LEAD_PRIORITIES), notes: str(1000), assignedAgentId: objectId }).partial().strict().refine(nonEmpty, 'Provide at least one field') }
export const completeFollowUpSchema = { body: z.object({ note: str(1000).optional() }) }
export const cancelSchema = { body: z.object({ reason: str(300).optional() }) }
export const listFollowUpsSchema = { query: z.object({ page: pagination.page, limit: z.coerce.number().int().min(1).max(200).default(20),
  bucket: z.enum(['overdue', 'today', 'upcoming', 'completed']).optional(), status: z.enum(['pending', 'completed', 'cancelled']).optional(),
  leadId: objectId.optional(), customerId: objectId.optional(), assignedAgent: objectId.optional(), type: z.enum(FOLLOWUP_TYPES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(), from: rangeDate.optional(), to: rangeDate.optional() }) }
export const followUpSummarySchema = { query: z.object({ assignedAgent: objectId.optional() }) }

// ---------- site visits
const feedback = z.object({ rating: z.number().int().min(1).max(5).optional(), comment: str(1000).optional(), interested: z.boolean().optional() }).strict()
  .refine(nonEmpty, 'Provide a rating, comment or interest')
const endAfterStart = (v) => !v.endAt || !v.startAt || (v.endAt > v.startAt && v.endAt - v.startAt <= 8 * 3600 * 1000)
const endMsg = 'End time must be after the start and within 8 hours'
export const createVisitSchema = { body: z.object({ leadId: objectId.optional(), customerId: objectId.optional(), propertyId: objectId, startAt: instant, endAt: instant.optional(),
  assignedAgentId: objectId.optional(), notes: str(1000).optional() }).strict()
  .refine((v) => !!v.leadId || !!v.customerId, 'Provide a lead or a customer').refine(endAfterStart, endMsg) }
export const updateVisitSchema = { body: z.object({ notes: str(1000), assignedAgentId: objectId }).partial().strict().refine(nonEmpty, 'Provide at least one field') }
export const rescheduleSchema = { body: z.object({ startAt: instant, endAt: instant.optional() }).strict().refine(endAfterStart, endMsg) }
export const completeVisitSchema = { body: z.object({ feedback: feedback.optional() }) }
export const visitFeedbackSchema = { body: feedback }
export const listVisitsSchema = { query: z.object({ ...pagination, status: z.enum(VISIT_STATUSES).optional(), assignedAgent: objectId.optional(), propertyId: objectId.optional(),
  customerId: objectId.optional(), leadId: objectId.optional(), from: rangeDate.optional(), to: rangeDate.optional() }) }
export const calendarSchema = { query: z.object({ from: rangeDate, to: rangeDate, assignedAgent: objectId.optional() })
  .refine((q) => q.to > q.from && q.to - q.from <= 62 * 86400000, 'Choose a range of at most 62 days') }
