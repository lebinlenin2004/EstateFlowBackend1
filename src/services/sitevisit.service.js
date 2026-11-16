import SiteVisit from '../models/SiteVisit.js'
import Property from '../models/Property.js'
import Customer from '../models/Customer.js'
import { ApiError } from '../utils/ApiError.js'
import { dayBounds, MINUTE } from '../utils/dates.js'
import { ROLES } from '../constants/roles.js'
import { assertAssignableAgent } from './agent.service.js'
import { agentScope, pinAgent, getOrgSettings } from './scope.service.js'
import { loadLead, logActivity, advanceToSiteVisit } from './lead.service.js'
import { audit } from './audit.service.js'

const withRefs = (q) => q.populate('customer', 'name phone').populate('property', 'code title address.city address.locality').populate('assignedAgent', 'name').populate('lead', 'code title')
const view = (v) => ({
  id: v.id, lead: v.lead ? { id: String(v.lead._id), code: v.lead.code, title: v.lead.title } : null,
  customer: v.customer ? { id: String(v.customer._id), name: v.customer.name, phone: v.customer.phone } : null,
  property: v.property ? { id: String(v.property._id), code: v.property.code, title: v.property.title, city: v.property.address?.city ?? null, locality: v.property.address?.locality ?? null } : null,
  assignedAgent: v.assignedAgent ? { id: String(v.assignedAgent._id), name: v.assignedAgent.name } : null,
  startAt: v.startAt, endAt: v.endAt, status: v.status, notes: v.notes ?? null, cancelReason: v.cancelReason ?? null, rescheduledCount: v.rescheduledCount,
  feedback: v.feedback?.recordedAt ? { rating: v.feedback.rating ?? null, comment: v.feedback.comment ?? null, interested: v.feedback.interested ?? null } : null,
  completedAt: v.completedAt ?? null, createdAt: v.createdAt,
})

async function load(auth, id) {
  const v = await withRefs(SiteVisit.findOne({ _id: id, ...(await agentScope(auth)) }))
  if (!v) throw ApiError.notFound('Site visit not found')
  return v
}
const assertFuture = (d) => { if (d.getTime() < Date.now() - 5 * MINUTE) throw ApiError.badRequest('Choose a time that has not passed') }
const logFor = (v, auth, type, summary, data) => v.lead && logActivity(auth, { _id: v.lead._id ?? v.lead, customer: v.customer._id ?? v.customer }, type, summary, data)

/** One agent, one property and one customer can each only be in one place at a time. */
async function assertNoConflict({ startAt, endAt, assignedAgent, property, customer, excludeId }) {
  const overlap = { status: 'scheduled', startAt: { $lt: endAt }, endAt: { $gt: startAt }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }
  const clash = (code, message) => new ApiError(409, message, [{ field: 'startAt', message: code }])
  if (assignedAgent && (await SiteVisit.exists({ ...overlap, assignedAgent }))) throw clash('agent_busy', 'That agent already has a site visit at this time')
  if (property && (await SiteVisit.exists({ ...overlap, property }))) throw clash('property_busy', 'This property already has a visit booked at this time')
  if (customer && (await SiteVisit.exists({ ...overlap, customer }))) throw clash('customer_busy', 'This customer already has a site visit at this time')
}

export async function createVisit(auth, { leadId, customerId, propertyId, startAt, endAt, assignedAgentId, notes }) {
  const lead = leadId ? await loadLead(auth, leadId) : null
  if (lead && ['converted', 'lost'].includes(lead.status)) throw ApiError.badRequest('Closed leads cannot have new site visits')
  let customer = lead?.customer
  if (!customer) {
    customer = await Customer.findOne({ _id: customerId, archivedAt: null, ...(await agentScope(auth)) })
    if (!customer) throw ApiError.badRequest('That customer does not exist')
  }
  const property = await Property.findOne({ _id: propertyId, archivedAt: null, ...(auth.role === ROLES.BRANCH_MANAGER ? { branch: auth.branchId } : {}) })
  if (!property) throw ApiError.badRequest('That property does not exist')
  if (!['available', 'reserved'].includes(property.status)) throw ApiError.badRequest(`This property is ${property.status} and cannot be visited`)
  assertFuture(startAt)
  const { visitDurationMinutes } = await getOrgSettings(auth.orgId)
  const end = endAt ?? new Date(startAt.getTime() + visitDurationMinutes * MINUTE)
  if (assignedAgentId) await assertAssignableAgent(auth, assignedAgentId)
  const agent = assignedAgentId ?? lead?.assignedAgent?._id ?? property.assignedAgent ?? auth.userId
  await assertNoConflict({ startAt, endAt: end, assignedAgent: agent, property: property._id, customer: customer._id })
  const v = await SiteVisit.create({ lead: lead?._id ?? null, customer: customer._id, property: property._id, assignedAgent: agent, startAt, endAt: end, notes, createdBy: auth.userId })
  if (lead) { await logActivity(auth, lead, 'site_visit_scheduled', `Site visit scheduled at ${property.title}`, { visitId: String(v._id), startAt }); await advanceToSiteVisit(auth, lead) }
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'sitevisit.created', entity: { type: 'SiteVisit', id: v._id } })
  return view(await load(auth, v.id))
}

function buildFilter(q, scope) {
  const f = pinAgent({ ...scope }, q.assignedAgent)
  if (q.status) f.status = q.status
  if (q.propertyId) f.property = q.propertyId
  if (q.customerId) f.customer = q.customerId
  if (q.leadId) f.lead = q.leadId
  if (q.from || q.to) f.startAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  return f
}

export async function listVisits(auth, q) {
  const f = buildFilter(q, await agentScope(auth))
  const [items, total] = await Promise.all([withRefs(SiteVisit.find(f).sort({ startAt: q.status === 'scheduled' ? 1 : -1, _id: 1 }).skip((q.page - 1) * q.limit).limit(q.limit)), SiteVisit.countDocuments(f)])
  return { items: items.map(view), meta: { page: q.page, limit: q.limit, total } }
}

/** Compact items for a calendar grid, capped at 500 visits. */
export async function calendar(auth, q) {
  const f = buildFilter({ ...q, from: q.from, to: q.to }, await agentScope(auth))
  f.status = { $ne: 'cancelled' }
  const items = await withRefs(SiteVisit.find(f).sort('startAt').limit(500))
  return items.map((v) => ({ id: v.id, title: `${v.customer?.name ?? 'Visit'} · ${v.property?.title ?? ''}`.trim(), startAt: v.startAt, endAt: v.endAt, status: v.status, assignedAgent: v.assignedAgent ? { id: String(v.assignedAgent._id), name: v.assignedAgent.name } : null }))
}

export async function visitSummary(auth, { assignedAgent } = {}) {
  const scope = pinAgent({ ...(await agentScope(auth)) }, assignedAgent)
  const { timezone } = await getOrgSettings(auth.orgId)
  const { start, end } = dayBounds(timezone)
  const [scheduled, today, completed, cancelled, noShow] = await Promise.all([
    SiteVisit.countDocuments({ ...scope, status: 'scheduled' }),
    SiteVisit.countDocuments({ ...scope, status: { $in: ['scheduled', 'completed'] }, startAt: { $gte: start, $lte: end } }),
    SiteVisit.countDocuments({ ...scope, status: 'completed' }), SiteVisit.countDocuments({ ...scope, status: 'cancelled' }), SiteVisit.countDocuments({ ...scope, status: 'no_show' }),
  ])
  return { scheduled, today, completed, cancelled, noShow }
}

export const getVisit = async (auth, id) => view(await load(auth, id))

const assertScheduled = (v) => { if (v.status !== 'scheduled') throw ApiError.conflict(`A ${v.status.replace('_', ' ')} visit cannot be changed`) }

export async function updateVisit(auth, id, { assignedAgentId, notes }) {
  const v = await load(auth, id)
  assertScheduled(v)
  if (assignedAgentId) {
    await assertAssignableAgent(auth, assignedAgentId)
    await assertNoConflict({ startAt: v.startAt, endAt: v.endAt, assignedAgent: assignedAgentId, excludeId: v._id })
    v.assignedAgent = assignedAgentId
  }
  if (notes !== undefined) v.notes = notes
  await v.save()
  return view(await load(auth, id))
}

export async function reschedule(auth, id, { startAt, endAt }) {
  const v = await load(auth, id)
  assertScheduled(v)
  assertFuture(startAt)
  const end = endAt ?? new Date(startAt.getTime() + (v.endAt - v.startAt))
  await assertNoConflict({ startAt, endAt: end, assignedAgent: v.assignedAgent?._id, property: v.property._id, customer: v.customer._id, excludeId: v._id })
  v.startAt = startAt
  v.endAt = end
  v.rescheduledCount += 1
  await v.save()
  await logFor(v, auth, 'site_visit_scheduled', `Site visit rescheduled to ${startAt.toISOString()}`, { visitId: v.id, startAt })
  return view(v)
}

export async function cancelVisit(auth, id, { reason }) {
  const v = await load(auth, id)
  assertScheduled(v)
  v.status = 'cancelled'
  v.cancelReason = reason
  await v.save()
  await logFor(v, auth, 'site_visit_cancelled', `Site visit cancelled${reason ? `: ${reason}` : ''}`, { visitId: v.id })
  return view(v)
}

const feedbackDoc = (fb) => ({ ...fb, recordedAt: new Date() })

export async function completeVisit(auth, id, { feedback }) {
  const v = await load(auth, id)
  assertScheduled(v)
  if (v.startAt.getTime() > Date.now() + 60 * MINUTE) throw ApiError.badRequest('This visit has not started yet')
  v.status = 'completed'
  v.completedAt = new Date()
  if (feedback) v.feedback = feedbackDoc(feedback)
  await v.save()
  await logFor(v, auth, 'site_visit_completed', `Site visit completed${feedback?.comment ? `: ${feedback.comment}` : ''}`, { visitId: v.id, ...(feedback ?? {}) })
  return view(v)
}

export async function markNoShow(auth, id) {
  const v = await load(auth, id)
  assertScheduled(v)
  if (v.startAt.getTime() > Date.now()) throw ApiError.badRequest('This visit has not started yet')
  v.status = 'no_show'
  await v.save()
  await logFor(v, auth, 'site_visit_cancelled', 'Customer did not show up', { visitId: v.id, noShow: true })
  return view(v)
}

export async function addFeedback(auth, id, feedback) {
  const v = await load(auth, id)
  if (v.status !== 'completed') throw ApiError.conflict('Feedback can be added once the visit is completed')
  v.feedback = feedbackDoc({ ...(v.feedback?.toObject?.() ?? {}), ...feedback })
  await v.save()
  return view(v)
}
