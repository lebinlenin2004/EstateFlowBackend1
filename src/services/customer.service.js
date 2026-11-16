import Customer from '../models/Customer.js'
import Membership from '../models/Membership.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { toMinor, fromMinor } from '../utils/money.js'
import { normalizePhone } from '../utils/phone.js'
import { ROLES } from '../constants/roles.js'
import { assertAssignableAgent } from './agent.service.js'
import { agentScope } from './scope.service.js'
import Lead from '../models/Lead.js'
import SiteVisit from '../models/SiteVisit.js'
import LeadActivity from '../models/LeadActivity.js'
import { audit } from './audit.service.js'

const scope = agentScope
const withRefs = (q) => q.populate('assignedAgent', 'name')
const view = (c) => ({ id: c.id, name: c.name, email: c.email ?? null, phone: c.phone, alternatePhone: c.alternatePhone ?? null, customerType: c.customerType, address: c.address ?? {},
  requirements: c.requirements ?? null, budget: { min: fromMinor(c.budget?.minMinor), max: fromMinor(c.budget?.maxMinor) }, preferredLocations: c.preferredLocations,
  preferences: { propertyTypes: c.preferences?.propertyTypes ?? [], listingType: c.preferences?.listingType ?? null, bedrooms: c.preferences?.bedrooms ?? null }, notes: c.notes ?? null,
  assignedAgent: c.assignedAgent ? { id: String(c.assignedAgent._id), name: c.assignedAgent.name } : null, archived: !!c.archivedAt, createdAt: c.createdAt, updatedAt: c.updatedAt })

async function load(auth, id, archived = false) {
  const c = await withRefs(Customer.findOne({ _id: id, archivedAt: archived ? { $ne: null } : null, ...(await scope(auth)) }))
  if (!c) throw ApiError.notFound('Customer not found')
  return c
}

async function assertNoDuplicate(auth, phone, excludeId) {
  const dup = await Customer.findOne({ phone, archivedAt: null, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
  if (!dup) return
  // Only reveal the existing record if the caller is allowed to see it.
  const visible = await Customer.exists({ _id: dup._id, ...(await scope(auth)) })
  throw new ApiError(409, 'A customer with this phone number already exists', visible ? [{ field: 'phone', message: 'Duplicate phone', existingId: dup.id }] : [])
}

const budgetDoc = (b) => (b ? { minMinor: b.min !== undefined ? toMinor(b.min) : undefined, maxMinor: b.max !== undefined ? toMinor(b.max) : undefined } : undefined)

export async function createCustomer(auth, body) {
  const { assignedAgentId, budget, ...rest } = body
  await assertNoDuplicate(auth, rest.phone)
  // Agents and branch managers own what they create, so it stays inside their scope.
  const agent = assignedAgentId ?? ([ROLES.SALES_AGENT, ROLES.BRANCH_MANAGER].includes(auth.role) ? auth.userId : null)
  if (agent) await assertAssignableAgent(auth, agent)
  const c = await Customer.create({ ...rest, budget: budgetDoc(budget), assignedAgent: agent, createdBy: auth.userId })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'customer.created', entity: { type: 'Customer', id: c._id } })
  return view(await load(auth, c.id))
}

export async function listCustomers(auth, { page, limit, search, customerType, assignedAgent, location, archived }) {
  const f = { archivedAt: archived ? { $ne: null } : null, ...(await scope(auth)) }
  if (customerType) f.customerType = customerType
  if (assignedAgent && ![ROLES.SALES_AGENT, ROLES.BRANCH_MANAGER].includes(auth.role)) f.assignedAgent = assignedAgent
  if (location) f.preferredLocations = new RegExp(escapeRegex(location), 'i')
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i'); const digits = normalizePhone(search)
    f.$and = [{ $or: [{ name: rx }, { email: rx }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRegex(digits)) }] : [])] }]
  }
  const [items, total] = await Promise.all([withRefs(Customer.find(f).sort('-createdAt').skip((page - 1) * limit).limit(limit)), Customer.countDocuments(f)])
  return { items: items.map(view), meta: { page, limit, total } }
}

export async function getCustomer(auth, id) { return view(await load(auth, id)) }

export async function updateCustomer(auth, id, body) {
  const c = await load(auth, id)
  const { assignedAgentId, budget, address, preferences, ...rest } = body
  if (rest.phone && rest.phone !== c.phone) await assertNoDuplicate(auth, rest.phone, c._id)
  if (assignedAgentId !== undefined) {
    if (assignedAgentId === null && [ROLES.SALES_AGENT, ROLES.BRANCH_MANAGER].includes(auth.role)) throw ApiError.forbidden('You cannot unassign this customer')
    if (assignedAgentId) await assertAssignableAgent(auth, assignedAgentId)
    c.assignedAgent = assignedAgentId
  }
  c.set(rest)
  if (budget) c.budget = { ...c.budget?.toObject?.(), ...budgetDoc(budget) }
  if (address) for (const [k, v] of Object.entries(address)) c.set(`address.${k}`, v)
  if (preferences) for (const [k, v] of Object.entries(preferences)) c.set(`preferences.${k}`, v)
  await c.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'customer.updated', entity: { type: 'Customer', id: c._id }, metadata: { fields: Object.keys(body) } })
  return view(await load(auth, id))
}

export async function archiveCustomer(auth, id) {
  const c = await load(auth, id)
  c.archivedAt = new Date()
  await c.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'customer.archived', entity: { type: 'Customer', id: c._id } })
}
export async function restoreCustomer(auth, id) {
  const c = await load(auth, id, true)
  await assertNoDuplicate(auth, c.phone, c._id)
  c.archivedAt = null
  await c.save()
  return view(await load(auth, id))
}

/** Everything that happened with a customer: leads, site visits and the lead activity trail. */
export async function customerHistory(auth, id) {
  const c = await load(auth, id)
  const s = await scope(auth)
  const [leads, visits] = await Promise.all([
    Lead.find({ customer: c._id, ...s }).sort('-createdAt').limit(50).populate('assignedAgent', 'name'),
    SiteVisit.find({ customer: c._id, ...s }).sort('-startAt').limit(50).populate('property', 'code title').populate('assignedAgent', 'name'),
  ])
  const activities = await LeadActivity.find({ customer: c._id, lead: { $in: leads.map((l) => l._id) } }).populate('actor', 'name').sort({ createdAt: -1, _id: -1 }).limit(50)
  return {
    leads: leads.map((l) => ({ id: l.id, code: l.code, title: l.title, status: l.status, priority: l.priority, assignedAgent: l.assignedAgent ? { id: String(l.assignedAgent._id), name: l.assignedAgent.name } : null, createdAt: l.createdAt })),
    siteVisits: visits.map((v) => ({ id: v.id, status: v.status, startAt: v.startAt, property: v.property ? { id: String(v.property._id), code: v.property.code, title: v.property.title } : null, assignedAgent: v.assignedAgent ? { id: String(v.assignedAgent._id), name: v.assignedAgent.name } : null })),
    activities: activities.map((a) => ({ id: a.id, leadId: String(a.lead), type: a.type, summary: a.summary ?? null, actor: a.actor ? { id: String(a.actor._id), name: a.actor.name } : null, at: a.createdAt })),
  }
}
