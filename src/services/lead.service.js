import mongoose from 'mongoose'
import Lead from '../models/Lead.js'
import LeadActivity from '../models/LeadActivity.js'
import Customer from '../models/Customer.js'
import Property from '../models/Property.js'
import PropertyHistory from '../models/PropertyHistory.js'
import Deal from '../models/Deal.js'
import Membership from '../models/Membership.js'
import { nextSequence } from '../models/Counter.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { toMinor, fromMinor } from '../utils/money.js'
import { ROLES } from '../constants/roles.js'
import { LEAD_STATUSES, OPEN_LEAD_STATUSES, QUALIFIED_LEAD_STATUSES, INTERACTION_TYPES } from '../constants/crm.js'
import { assertAssignableAgent } from './agent.service.js'
import { agentScope, pinAgent, castAgentFilter, getOrgSettings, oid } from './scope.service.js'
import { audit } from './audit.service.js'

const SORTS = { newest: { createdAt: -1, _id: -1 }, oldest: { createdAt: 1, _id: 1 }, activity: { lastInteractionAt: -1, _id: -1 } }
const SOLD_FOR = { sale: 'sold', rent: 'rented', lease: 'rented' }
const AGENT_ROLES = [ROLES.SALES_AGENT, ROLES.BRANCH_MANAGER]
const pretty = (s) => s.replace(/_/g, ' ')

const withRefs = (q) => q.populate('customer', 'name phone email').populate('assignedAgent', 'name').populate('interestedProperties', 'code title').populate('deal', 'valueMinor type closedAt')
const budgetDoc = (b) => (b ? { minMinor: b.min !== undefined ? toMinor(b.min) : undefined, maxMinor: b.max !== undefined ? toMinor(b.max) : undefined } : undefined)

export const leadView = (l) => ({
  id: l.id, code: l.code, title: l.title, status: l.status, priority: l.priority, source: l.source, requirements: l.requirements ?? null,
  customer: l.customer ? { id: String(l.customer._id), name: l.customer.name, phone: l.customer.phone, email: l.customer.email ?? null } : null,
  budget: { min: fromMinor(l.budget?.minMinor), max: fromMinor(l.budget?.maxMinor) }, preferredLocations: l.preferredLocations, propertyType: l.propertyType ?? null,
  interestedProperties: l.interestedProperties.filter(Boolean).map((p) => ({ id: String(p._id), code: p.code, title: p.title })),
  assignedAgent: l.assignedAgent ? { id: String(l.assignedAgent._id), name: l.assignedAgent.name } : null,
  lostReason: l.lostReason ?? null, lastInteractionAt: l.lastInteractionAt, convertedAt: l.convertedAt ?? null,
  deal: l.deal ? { id: String(l.deal._id), value: fromMinor(l.deal.valueMinor), type: l.deal.type, closedAt: l.deal.closedAt } : null,
  archived: !!l.archivedAt, createdAt: l.createdAt, updatedAt: l.updatedAt,
})

/** Loads a lead the caller is allowed to see. Shared with follow-ups and site visits. */
export async function loadLead(auth, id, { archived = false } = {}) {
  const lead = await withRefs(Lead.findOne({ _id: id, archivedAt: archived ? { $ne: null } : null, ...(await agentScope(auth)) }))
  if (!lead) throw ApiError.notFound('Lead not found')
  return lead
}

export async function logActivity(auth, lead, type, summary, data, session) {
  const customer = lead.customer?._id ?? lead.customer
  await LeadActivity.create([{ lead: lead._id, customer, actor: auth.userId, type, summary, data }], session ? { session } : {})
  if (INTERACTION_TYPES.includes(type)) await Lead.updateOne({ _id: lead._id }, { lastInteractionAt: new Date() }, session ? { session } : {})
}

/** A booked site visit moves an early-stage lead to "site visit scheduled". */
export async function advanceToSiteVisit(auth, lead) {
  if (!['new', 'contacted', 'interested'].includes(lead.status)) return
  const from = lead.status
  await Lead.updateOne({ _id: lead._id }, { status: 'site_visit_scheduled' })
  await logActivity(auth, lead, 'status_changed', `Status changed from ${pretty(from)} to site visit scheduled`, { from, to: 'site_visit_scheduled', auto: true })
}

async function assertProperties(ids) {
  const found = await Property.countDocuments({ _id: { $in: ids }, archivedAt: null })
  if (found !== new Set(ids).size) throw ApiError.badRequest('One or more interested properties do not exist')
}

async function resolveCustomer(auth, { customerId, contact, agent }) {
  const scope = await agentScope(auth)
  if (customerId) {
    const c = await Customer.findOne({ _id: customerId, archivedAt: null, ...scope })
    if (!c) throw ApiError.badRequest('That customer does not exist')
    return c
  }
  const existing = await Customer.findOne({ phone: contact.phone, archivedAt: null })
  if (existing) { // same phone number: reuse the customer if the caller may see them, otherwise do not leak or duplicate
    if (!(await Customer.exists({ _id: existing._id, ...scope }))) throw ApiError.conflict('A customer with this phone number already exists. Ask your manager to assign them to you.')
    return existing
  }
  return Customer.create({ name: contact.name, phone: contact.phone, email: contact.email, customerType: 'buyer', assignedAgent: agent, createdBy: auth.userId })
}

async function pickAutoAssignee(auth) {
  const members = await Membership.find({ organization: auth.orgId, role: ROLES.SALES_AGENT, status: 'active', ...(auth.role === ROLES.BRANCH_MANAGER ? { branch: auth.branchId } : {}) }).select('user')
  if (!members.length) return null
  const ids = members.map((m) => m.user)
  const rows = await Lead.aggregate([{ $match: { assignedAgent: { $in: ids }, archivedAt: null, status: { $in: OPEN_LEAD_STATUSES } } }, { $group: { _id: '$assignedAgent', n: { $sum: 1 } } }])
  const load = new Map(rows.map((r) => [String(r._id), r.n]))
  return String(ids.reduce((best, id) => ((load.get(String(id)) ?? 0) < (load.get(String(best)) ?? 0) ? id : best), ids[0])) // least-loaded agent
}

export async function createLead(auth, body) {
  const { customerId, contact, interestedPropertyIds, assignedAgentId, budget, notes, ...rest } = body
  const settings = await getOrgSettings(auth.orgId)
  let agent = assignedAgentId ?? null
  if (!agent && AGENT_ROLES.includes(auth.role)) agent = auth.userId // agents own what they create
  if (!agent && settings.leadAutoAssign) agent = await pickAutoAssignee(auth)
  if (agent) await assertAssignableAgent(auth, agent)
  if (interestedPropertyIds?.length) await assertProperties(interestedPropertyIds)
  const customer = await resolveCustomer(auth, { customerId, contact, agent })
  const code = `LD-${String(await nextSequence(auth.orgId, 'lead')).padStart(4, '0')}`
  const lead = await Lead.create({ ...rest, code, title: rest.title ?? `${customer.name}${rest.propertyType ? ` · ${pretty(rest.propertyType)}` : ' · enquiry'}`, customer: customer._id,
    budget: budgetDoc(budget), interestedProperties: interestedPropertyIds ?? [], assignedAgent: agent, createdBy: auth.userId })
  await logActivity(auth, lead, 'lead_created', `Lead created from ${pretty(lead.source)}`)
  if (notes) await logActivity(auth, lead, 'note_added', notes)
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'lead.created', entity: { type: 'Lead', id: lead._id } })
  return leadView(await loadLead(auth, lead.id))
}

async function buildFilter(auth, q) {
  const f = { archivedAt: q.archived ? { $ne: null } : null, ...(await agentScope(auth)) }
  if (q.status?.length) f.status = { $in: q.status }
  for (const k of ['priority', 'source', 'propertyType']) if (q[k]) f[k] = q[k]
  pinAgent(f, q.assignedAgent)
  if (q.unassigned && !f.assignedAgent) f.assignedAgent = null
  if (q.customerId) f.customer = q.customerId
  if (q.createdFrom || q.createdTo) f.createdAt = { ...(q.createdFrom && { $gte: q.createdFrom }), ...(q.createdTo && { $lte: q.createdTo }) }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i')
    const customerIds = await Customer.find({ $or: [{ name: rx }, { phone: rx }] }).distinct('_id')
    f.$or = [{ title: rx }, { code: rx }, { customer: { $in: customerIds } }]
  }
  return f
}

export async function listLeads(auth, q) {
  const f = await buildFilter(auth, q)
  const [items, total] = await Promise.all([withRefs(Lead.find(f).sort(SORTS[q.sort]).skip((q.page - 1) * q.limit).limit(q.limit)), Lead.countDocuments(f)])
  return { items: items.map(leadView), meta: { page: q.page, limit: q.limit, total } }
}

/** Kanban data: counts for every stage plus the most recently active cards of each. */
const castForAggregate = (f) => { const m = castAgentFilter(f); return m.customer ? { ...m, customer: oid(m.customer) } : m }

export async function pipeline(auth, q) {
  const { perStage, ...filters } = q
  const base = await buildFilter(auth, { ...filters, status: undefined })
  const [counts, columns] = await Promise.all([
    Lead.aggregate([{ $match: castForAggregate(base) }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Promise.all(LEAD_STATUSES.map((s) => withRefs(Lead.find({ ...base, status: s }).sort(SORTS.activity).limit(perStage)))),
  ])
  const byStatus = new Map(counts.map((c) => [c._id, c.n]))
  return LEAD_STATUSES.map((status, i) => ({ status, count: byStatus.get(status) ?? 0, leads: columns[i].map(leadView) }))
}

export async function leadStats(auth, { assignedAgent }) {
  const base = castAgentFilter(pinAgent({ archivedAt: null, ...(await agentScope(auth)) }, assignedAgent))
  const [r] = await Lead.aggregate([{ $match: base }, { $facet: {
    status: [{ $group: { _id: '$status', n: { $sum: 1 } } }], source: [{ $group: { _id: '$source', n: { $sum: 1 } } }], priority: [{ $group: { _id: '$priority', n: { $sum: 1 } } }],
  } }])
  const map = (rows) => Object.fromEntries(rows.map((x) => [x._id, x.n]))
  const byStatus = map(r.status)
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0)
  const converted = byStatus.converted ?? 0
  return { total, new: byStatus.new ?? 0, qualified: QUALIFIED_LEAD_STATUSES.reduce((a, s) => a + (byStatus[s] ?? 0), 0), converted, lost: byStatus.lost ?? 0,
    conversionRate: total ? Math.round((1000 * converted) / total) / 10 : 0, byStatus, bySource: map(r.source), byPriority: map(r.priority) }
}

export const getLead = async (auth, id) => leadView(await loadLead(auth, id))

export async function updateLead(auth, id, body) {
  const lead = await loadLead(auth, id)
  const { interestedPropertyIds, budget, ...rest } = body
  if (interestedPropertyIds) { await assertProperties(interestedPropertyIds); lead.interestedProperties = interestedPropertyIds }
  if (budget) lead.budget = { ...lead.budget?.toObject?.(), ...budgetDoc(budget) }
  lead.set(rest)
  await lead.save()
  await logActivity(auth, lead, 'lead_updated', `Updated ${Object.keys(body).map((k) => k.replace(/Ids?$/, '')).join(', ')}`, { fields: Object.keys(body) })
  return leadView(await loadLead(auth, id))
}

export async function setStatus(auth, id, { status, lostReason }) {
  const lead = await loadLead(auth, id)
  if (lead.status === 'converted') throw ApiError.conflict('A converted lead cannot change status')
  if (lead.status === status) return leadView(lead)
  const from = lead.status
  lead.status = status
  lead.lostReason = status === 'lost' ? lostReason : undefined
  await lead.save()
  await logActivity(auth, lead, 'status_changed', `Status changed from ${pretty(from)} to ${pretty(status)}${lostReason ? `: ${lostReason}` : ''}`, { from, to: status, lostReason })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'lead.status_changed', entity: { type: 'Lead', id: lead._id }, metadata: { from, to: status } })
  return leadView(await loadLead(auth, id))
}

export async function setPriority(auth, id, { priority }) {
  const lead = await loadLead(auth, id)
  if (lead.priority === priority) return leadView(lead)
  const from = lead.priority
  lead.priority = priority
  await lead.save()
  await logActivity(auth, lead, 'priority_changed', `Priority changed from ${from} to ${priority}`, { from, to: priority })
  return leadView(await loadLead(auth, id))
}

export async function assignLead(auth, id, { agentId }) {
  const lead = await loadLead(auth, id)
  if (agentId) await assertAssignableAgent(auth, agentId)
  const from = lead.assignedAgent ? String(lead.assignedAgent._id) : null
  lead.assignedAgent = agentId
  await lead.save()
  if (agentId) await Customer.updateOne({ _id: lead.customer._id, assignedAgent: null }, { assignedAgent: agentId }) // an unowned customer follows the lead
  await logActivity(auth, lead, 'agent_assigned', agentId ? 'Lead assigned' : 'Lead unassigned', { from, to: agentId })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'lead.assigned', entity: { type: 'Lead', id: lead._id }, metadata: { from, to: agentId } })
  // The caller may no longer be allowed to see it after reassigning, so answer from the saved document.
  return leadView(await withRefs(Lead.findById(lead._id)))
}

export async function archiveLead(auth, id) {
  const lead = await loadLead(auth, id)
  lead.archivedAt = new Date()
  await lead.save()
  await logActivity(auth, lead, 'archived', 'Lead archived')
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'lead.archived', entity: { type: 'Lead', id: lead._id } })
}
export async function restoreLead(auth, id) {
  const lead = await loadLead(auth, id, { archived: true })
  lead.archivedAt = null
  await lead.save()
  await logActivity(auth, lead, 'restored', 'Lead restored')
  return leadView(await loadLead(auth, id))
}

export async function addActivity(auth, id, { type, summary }) {
  const lead = await loadLead(auth, id)
  await logActivity(auth, lead, type, summary)
  return listActivities(auth, id, { page: 1, limit: 1 }).then((r) => r.items[0])
}

export async function listActivities(auth, id, { page, limit }) {
  const lead = await Lead.findOne({ _id: id, ...(await agentScope(auth)) }) // archived leads keep a readable history
  if (!lead) throw ApiError.notFound('Lead not found')
  const f = { lead: lead._id }
  const [items, total] = await Promise.all([LeadActivity.find(f).populate('actor', 'name').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), LeadActivity.countDocuments(f)])
  return { items: items.map((a) => ({ id: a.id, type: a.type, summary: a.summary ?? null, data: a.data ?? null, actor: a.actor ? { id: String(a.actor._id), name: a.actor.name } : null, at: a.createdAt })), meta: { page, limit, total } }
}

const isNoReplicaSet = (e) => e?.code === 20 || /replica set|Transaction numbers/i.test(e?.message ?? '')

/** Converts a lead into a closed deal. All writes succeed or none do (needs a MongoDB replica set). */
export async function convertLead(auth, id, { propertyId, dealValue, dealType, closedAt }) {
  const lead = await loadLead(auth, id)
  if (lead.status === 'converted') throw ApiError.conflict('This lead is already converted')
  if (lead.status === 'lost') throw ApiError.badRequest('Reopen this lead before converting it')
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      let type = dealType
      let property = null
      if (propertyId) {
        property = await Property.findOne({ _id: propertyId, archivedAt: null }).session(session)
        if (!property) throw ApiError.badRequest('That property does not exist')
        if (!['available', 'reserved'].includes(property.status)) throw ApiError.conflict(`That property is already ${property.status}`)
        type = property.listingType
      }
      const [deal] = await Deal.create([{ lead: lead._id, customer: lead.customer._id, property: property?._id ?? null, assignedAgent: lead.assignedAgent?._id ?? null,
        type, valueMinor: toMinor(dealValue), closedAt: closedAt ?? new Date(), createdBy: auth.userId }], { session })
      if (property) {
        const from = property.status
        property.status = SOLD_FOR[type]
        await property.save({ session })
        await PropertyHistory.create([{ property: property._id, actor: auth.userId, action: 'status_changed', changes: { status: [from, property.status], note: `Deal closed (${lead.code})` } }], { session })
      }
      lead.status = 'converted'
      lead.convertedAt = deal.closedAt
      lead.deal = deal._id
      lead.lostReason = undefined
      await lead.save({ session })
      await logActivity(auth, lead, 'converted', `Converted: ${type} deal`, { dealId: String(deal._id), valueMinor: deal.valueMinor }, session)
    })
  } catch (err) {
    if (isNoReplicaSet(err)) throw new ApiError(503, 'Converting leads needs MongoDB running as a replica set. See the README (docker compose up -d).')
    throw err
  } finally { await session.endSession() }
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'lead.converted', entity: { type: 'Lead', id: lead._id } })
  return leadView(await loadLead(auth, id))
}
