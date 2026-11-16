import mongoose from 'mongoose'
import Membership from '../models/Membership.js'
import Organization from '../models/Organization.js'
import { ApiError } from '../utils/ApiError.js'
import { ROLES } from '../constants/roles.js'

/** Object-level scope for anything owned by an agent (customers, leads, follow-ups, visits):
 *  agents see only their own records, branch managers those of agents in their branch, everyone else all. */
export async function agentScope(auth) {
  if (auth.role === ROLES.SALES_AGENT) return { assignedAgent: auth.userId }
  if (auth.role === ROLES.BRANCH_MANAGER) {
    if (!auth.branchId) throw ApiError.forbidden('You are not assigned to a branch')
    return { assignedAgent: { $in: await Membership.find({ organization: auth.orgId, branch: auth.branchId, status: 'active' }).distinct('user') } }
  }
  return {}
}

/** Narrow an already-scoped filter to one requested agent without ever widening it. */
export function pinAgent(filter, requested) {
  if (!requested) return filter
  const s = filter.assignedAgent
  if (!s) filter.assignedAgent = requested
  else if (s.$in) filter.assignedAgent = s.$in.map(String).includes(String(requested)) ? requested : { $in: [] }
  return filter // an agent's own scope already pins assignedAgent
}

export const oid = (v) => new mongoose.Types.ObjectId(String(v))
/** Aggregations do not cast strings to ObjectIds, so cast the agent filter by hand. */
export function castAgentFilter(f) {
  const a = f.assignedAgent
  if (!a) return f
  return { ...f, assignedAgent: a.$in ? { $in: a.$in.map(oid) } : oid(a) }
}

export async function getOrgSettings(orgId) {
  const o = await Organization.findById(orgId).select('settings')
  return { timezone: o?.settings?.timezone ?? 'Asia/Kolkata', visitDurationMinutes: o?.settings?.visitDurationMinutes ?? 60, leadAutoAssign: !!o?.settings?.leadAutoAssign }
}
