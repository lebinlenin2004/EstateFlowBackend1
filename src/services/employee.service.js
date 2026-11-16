import mongoose from 'mongoose'
import Membership from '../models/Membership.js'
import Invitation from '../models/Invitation.js'
import RefreshSession from '../models/RefreshSession.js'
import User from '../models/User.js'
import Branch from '../models/Branch.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { ROLES, TENANT_ROLES, INVITABLE_ROLES } from '../constants/roles.js'
import Lead from '../models/Lead.js'
import { OPEN_LEAD_STATUSES } from '../constants/crm.js'
import { audit } from './audit.service.js'

const manageable = (auth) => (auth.role === ROLES.OWNER ? TENANT_ROLES : INVITABLE_ROLES[auth.role] ?? [])

function baseFilter(auth) {
  const f = { organization: auth.orgId, status: { $ne: 'removed' } }
  if (auth.role === ROLES.BRANCH_MANAGER) {
    if (!auth.branchId) throw ApiError.forbidden('You are not assigned to a branch')
    f.branch = auth.branchId
  }
  return f
}

const view = (m, stats = { assignedLeads: 0, conversions: 0 }) => ({ id: m.id, role: m.role, status: m.status, joinedAt: m.createdAt, stats,
  branch: m.branch ? { id: String(m.branch._id ?? m.branch), name: m.branch.name ?? null, code: m.branch.code ?? null } : null,
  user: m.user ? { id: String(m.user._id), name: m.user.name, email: m.user.email, phone: m.user.phone ?? null, lastLoginAt: m.user.lastLoginAt ?? null } : null })
const populate = (q) => q.populate('user', 'name email phone lastLoginAt').populate('branch', 'name code')

/** Open leads and conversions per agent, for the employees dashboard. */
async function leadStatsFor(userIds) {
  const rows = userIds.length ? await Lead.aggregate([{ $match: { assignedAgent: { $in: userIds }, archivedAt: null } }, { $group: { _id: { a: '$assignedAgent', s: '$status' }, n: { $sum: 1 } } }]) : []
  const out = new Map()
  for (const { _id, n } of rows) {
    const cur = out.get(String(_id.a)) ?? { assignedLeads: 0, conversions: 0 }
    if (OPEN_LEAD_STATUSES.includes(_id.s)) cur.assignedLeads += n
    if (_id.s === 'converted') cur.conversions += n
    out.set(String(_id.a), cur)
  }
  return out
}

async function loadTarget(auth, id) {
  const m = await populate(Membership.findOne({ ...baseFilter(auth), _id: id }))
  if (!m) throw ApiError.notFound('Employee not found')
  return m
}

function assertCanManage(auth, target, newRole) {
  if (String(target.user._id) === auth.userId) throw ApiError.forbidden('You cannot change your own role, branch or status')
  const allowed = manageable(auth)
  if (!allowed.includes(target.role)) throw ApiError.forbidden(`You cannot manage a ${target.role.replace('_', ' ')}`)
  if (newRole && !allowed.includes(newRole)) throw ApiError.forbidden(`You cannot assign the ${newRole.replace('_', ' ')} role`)
}

async function assertAnotherOwner(auth, target) {
  if (target.role !== ROLES.OWNER) return
  const others = await Membership.countDocuments({ organization: auth.orgId, role: ROLES.OWNER, status: 'active', _id: { $ne: target._id } })
  if (others === 0) throw ApiError.badRequest('An organization must keep at least one active owner')
}

const endSessions = (membershipId) => RefreshSession.updateMany({ membership: membershipId, revokedAt: null }, { revokedAt: new Date() })

export async function listEmployees(auth, { page, limit, search, role, status, branchId }) {
  const filter = baseFilter(auth)
  if (role) filter.role = role
  if (status) filter.status = status
  if (branchId && auth.role !== ROLES.BRANCH_MANAGER) filter.branch = branchId
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i')
    const memberIds = await Membership.find(filter).distinct('user') // search only among this organization's people
    filter.user = { $in: await User.find({ _id: { $in: memberIds }, $or: [{ name: rx }, { email: rx }] }).distinct('_id') }
  }
  const [items, total] = await Promise.all([
    populate(Membership.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit)),
    Membership.countDocuments(filter),
  ])
  const stats = await leadStatsFor(items.map((m) => m.user?._id).filter(Boolean))
  return { items: items.map((m) => view(m, stats.get(String(m.user?._id)))), meta: { page, limit, total } }
}

export async function getEmployee(auth, id) {
  const m = await loadTarget(auth, id)
  return view(m, (await leadStatsFor([m.user._id])).get(String(m.user._id)))
}

export async function updateEmployee(auth, id, { role, branchId }) {
  const target = await loadTarget(auth, id)
  assertCanManage(auth, target, role)
  const before = { role: target.role, branch: target.branch ? String(target.branch._id) : null }
  if (role && role !== target.role) {
    await assertAnotherOwner(auth, target)
    target.role = role
  }
  if (branchId !== undefined) {
    if (auth.role === ROLES.BRANCH_MANAGER) throw ApiError.forbidden('Branch managers cannot move employees between branches')
    if (branchId && !(await Branch.exists({ _id: branchId, status: 'active' }))) throw ApiError.badRequest('That branch does not exist or is inactive')
    target.branch = branchId
  }
  await target.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'member.updated', entity: { type: 'Membership', id: target._id }, metadata: { before, after: { role: target.role, branch: branchId ?? before.branch } } })
  return view(await populate(Membership.findById(target._id)))
}

export async function setEmployeeStatus(auth, id, status) {
  const target = await loadTarget(auth, id)
  assertCanManage(auth, target)
  if (status === 'inactive') { await assertAnotherOwner(auth, target); await endSessions(target._id) }
  target.status = status
  await target.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: `member.${status === 'active' ? 'activated' : 'deactivated'}`, entity: { type: 'Membership', id: target._id } })
  return view(target)
}

export async function removeEmployee(auth, id) {
  const target = await loadTarget(auth, id)
  assertCanManage(auth, target)
  await assertAnotherOwner(auth, target)
  target.status = 'removed'
  await target.save()
  await endSessions(target._id)
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'member.removed', entity: { type: 'Membership', id: target._id } })
}

export async function employeeSummary(auth) {
  const rows = await Membership.aggregate([{ $match: { ...baseFilter(auth), organization: new mongoose.Types.ObjectId(String(auth.orgId)), ...(auth.branchId && auth.role === ROLES.BRANCH_MANAGER ? { branch: new mongoose.Types.ObjectId(auth.branchId) } : {}) } },
    { $group: { _id: { status: '$status', role: '$role' }, n: { $sum: 1 } } }])
  const out = { total: 0, active: 0, inactive: 0, byRole: {} }
  for (const { _id, n } of rows) { out.total += n; out[_id.status] += n; if (_id.status === 'active') out.byRole[_id.role] = (out.byRole[_id.role] ?? 0) + n }
  out.pendingInvitations = await Invitation.countDocuments({ organization: auth.orgId, status: 'pending', expiresAt: { $gt: new Date() }, ...(auth.role === ROLES.BRANCH_MANAGER ? { branch: auth.branchId } : {}) })
  return out
}

export async function listInvitations(auth) {
  const f = { organization: auth.orgId, status: 'pending', expiresAt: { $gt: new Date() } }
  if (auth.role === ROLES.BRANCH_MANAGER) f.branch = auth.branchId
  const items = await Invitation.find(f).populate('branch', 'name').sort('-createdAt')
  return items.map((i) => ({ id: i.id, email: i.email, role: i.role, branch: i.branch ? { id: String(i.branch._id), name: i.branch.name } : null, expiresAt: i.expiresAt, createdAt: i.createdAt }))
}

export async function revokeInvitation(auth, id) {
  const f = { _id: id, organization: auth.orgId, status: 'pending' }
  if (auth.role === ROLES.BRANCH_MANAGER) f.branch = auth.branchId
  const inv = await Invitation.findOne(f)
  if (!inv || !manageable(auth).includes(inv.role)) throw ApiError.notFound('Invitation not found')
  inv.status = 'revoked'
  await inv.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'member.invitation_revoked', entity: { type: 'Invitation', id: inv._id } })
}
