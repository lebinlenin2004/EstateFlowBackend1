import FollowUp from '../models/FollowUp.js'
import { ApiError } from '../utils/ApiError.js'
import { dayBounds, MINUTE } from '../utils/dates.js'
import { assertAssignableAgent } from './agent.service.js'
import { agentScope, pinAgent, getOrgSettings } from './scope.service.js'
import { loadLead, logActivity } from './lead.service.js'
import { audit } from './audit.service.js'

const withRefs = (q) => q.populate('lead', 'code title status').populate('customer', 'name phone').populate('assignedAgent', 'name')
const view = (f) => ({
  id: f.id, lead: f.lead ? { id: String(f.lead._id), code: f.lead.code, title: f.lead.title } : null,
  customer: f.customer ? { id: String(f.customer._id), name: f.customer.name, phone: f.customer.phone } : null,
  assignedAgent: f.assignedAgent ? { id: String(f.assignedAgent._id), name: f.assignedAgent.name } : null,
  dueAt: f.dueAt, type: f.type, priority: f.priority, notes: f.notes ?? null, status: f.status,
  overdue: f.status === 'pending' && f.dueAt < new Date(), completedAt: f.completedAt ?? null, completionNote: f.completionNote ?? null, createdAt: f.createdAt,
})

async function load(auth, id) {
  const f = await withRefs(FollowUp.findOne({ _id: id, ...(await agentScope(auth)) }))
  if (!f) throw ApiError.notFound('Follow-up not found')
  return f
}
const assertFuture = (d) => { if (d.getTime() < Date.now() - 5 * MINUTE) throw ApiError.badRequest('Choose a time that has not passed') }

export async function createFollowUp(auth, { leadId, dueAt, type, priority, notes, assignedAgentId }) {
  const lead = await loadLead(auth, leadId)
  if (['converted', 'lost'].includes(lead.status)) throw ApiError.badRequest('Closed leads cannot have follow-ups. Reopen the lead first.')
  assertFuture(dueAt)
  if (assignedAgentId) await assertAssignableAgent(auth, assignedAgentId)
  const agent = assignedAgentId ?? lead.assignedAgent?._id ?? auth.userId
  const f = await FollowUp.create({ lead: lead._id, customer: lead.customer._id, assignedAgent: agent, dueAt, type, priority, notes, createdBy: auth.userId })
  await logActivity(auth, lead, 'follow_up_scheduled', `${type} follow-up scheduled`, { followUpId: String(f._id), dueAt })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'followup.created', entity: { type: 'FollowUp', id: f._id } })
  return view(await load(auth, f.id))
}

/** Pending follow-ups split cleanly by "now": overdue (already past), today (rest of today), upcoming (later). */
async function bucketFilter(auth, bucket) {
  const { timezone } = await getOrgSettings(auth.orgId)
  const now = new Date()
  const { end } = dayBounds(timezone, now)
  switch (bucket) {
    case 'overdue': return { status: 'pending', dueAt: { $lt: now } }
    case 'today': return { status: 'pending', dueAt: { $gte: now, $lte: end } }
    case 'upcoming': return { status: 'pending', dueAt: { $gt: end } }
    case 'completed': return { status: 'completed' }
    default: return {}
  }
}

export async function listFollowUps(auth, q) {
  const f = { ...(await agentScope(auth)), ...(await bucketFilter(auth, q.bucket)) }
  pinAgent(f, q.assignedAgent)
  for (const k of ['status', 'type', 'priority']) if (q[k]) f[k] = q[k]
  if (q.leadId) f.lead = q.leadId
  if (q.customerId) f.customer = q.customerId
  if (q.from || q.to) f.dueAt = { ...f.dueAt, ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) }
  const sort = q.bucket === 'completed' ? { completedAt: -1, _id: -1 } : { dueAt: q.status === 'completed' || q.leadId ? -1 : 1, _id: 1 }
  const [items, total] = await Promise.all([withRefs(FollowUp.find(f).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit)), FollowUp.countDocuments(f)])
  return { items: items.map(view), meta: { page: q.page, limit: q.limit, total } }
}

export async function followUpSummary(auth, { assignedAgent }) {
  const scope = pinAgent({ ...(await agentScope(auth)) }, assignedAgent)
  const count = async (bucket) => FollowUp.countDocuments({ ...scope, ...(await bucketFilter(auth, bucket)) })
  const [overdue, today, upcoming, completed] = await Promise.all(['overdue', 'today', 'upcoming', 'completed'].map(count))
  return { overdue, today, upcoming, completed }
}

export const getFollowUp = async (auth, id) => view(await load(auth, id))

export async function updateFollowUp(auth, id, { assignedAgentId, ...patch }) {
  const f = await load(auth, id)
  if (f.status !== 'pending') throw ApiError.conflict(`A ${f.status} follow-up cannot be changed`)
  if (patch.dueAt) assertFuture(patch.dueAt)
  if (assignedAgentId) { await assertAssignableAgent(auth, assignedAgentId); f.assignedAgent = assignedAgentId }
  f.set(patch)
  await f.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'followup.updated', entity: { type: 'FollowUp', id: f._id }, metadata: { fields: Object.keys({ ...patch, ...(assignedAgentId && { assignedAgentId }) }) } })
  return view(await load(auth, id))
}

export async function completeFollowUp(auth, id, { note }) {
  const f = await load(auth, id)
  if (f.status !== 'pending') throw ApiError.conflict(`This follow-up is already ${f.status}`)
  f.status = 'completed'
  f.completedAt = new Date()
  f.completionNote = note
  await f.save()
  await logActivity(auth, { _id: f.lead._id, customer: f.customer._id }, 'follow_up_completed', `Completed ${f.type} follow-up${note ? `: ${note}` : ''}`, { followUpId: f.id })
  return view(f)
}

export async function cancelFollowUp(auth, id, { reason }) {
  const f = await load(auth, id)
  if (f.status !== 'pending') throw ApiError.conflict(`This follow-up is already ${f.status}`)
  f.status = 'cancelled'
  f.cancelReason = reason
  await f.save()
  return view(f)
}
