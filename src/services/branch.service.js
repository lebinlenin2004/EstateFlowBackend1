import mongoose from 'mongoose'
import Branch from '../models/Branch.js'
import Membership from '../models/Membership.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { ROLES } from '../constants/roles.js'
import { audit } from './audit.service.js'

// Every Branch query below is tenant-scoped by the tenantScope plugin; no organization filter is written by hand.
const view = (b, employeeCount) => ({ id: b.id, name: b.name, code: b.code, address: b.address ?? {}, phone: b.phone ?? null, email: b.email ?? null,
  manager: b.manager ? { id: String(b.manager._id ?? b.manager), name: b.manager.name ?? null } : null, status: b.status, employeeCount, createdAt: b.createdAt })

const scope = (auth) => {
  if (auth.role !== ROLES.BRANCH_MANAGER) return {}
  if (!auth.branchId) throw ApiError.forbidden('You are not assigned to a branch')
  return { _id: auth.branchId }
}

async function checkManager(auth, userId) {
  if (!userId) return
  const ok = await Membership.exists({ user: userId, organization: auth.orgId, status: 'active', role: { $in: [ROLES.BRANCH_MANAGER, ROLES.OWNER] } })
  if (!ok) throw ApiError.badRequest('The manager must be an active branch manager or owner of this organization')
}

const countsFor = async (auth, ids) => {
  const rows = await Membership.aggregate([{ $match: { organization: new mongoose.Types.ObjectId(String(auth.orgId)), status: 'active', branch: { $in: ids } } }, { $group: { _id: '$branch', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

export async function createBranch(auth, body) {
  await checkManager(auth, body.manager)
  let n = (await Branch.countDocuments()) + 1
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const branch = await Branch.create({ ...body, code: body.code ?? `BR-${String(n).padStart(3, '0')}`, createdBy: auth.userId })
      await audit({ organization: auth.orgId, actor: auth.userId, action: 'branch.created', entity: { type: 'Branch', id: branch._id } })
      return view(branch, 0)
    } catch (err) {
      if (err.code !== 11000) throw err
      if (body.code) throw ApiError.conflict('A branch with this code already exists')
      n += 1 // auto-generated code collided; try the next number
    }
  }
  throw ApiError.conflict('Could not generate a unique branch code. Provide one.')
}

export async function listBranches(auth, { page, limit, search, status }) {
  const filter = { ...scope(auth) }
  if (status) filter.status = status
  if (search) { const rx = new RegExp(escapeRegex(search), 'i'); filter.$or = [{ name: rx }, { code: rx }, { 'address.city': rx }] }
  const [items, total] = await Promise.all([
    Branch.find(filter).populate('manager', 'name').sort('name').skip((page - 1) * limit).limit(limit),
    Branch.countDocuments(filter),
  ])
  const counts = await countsFor(auth, items.map((b) => b._id))
  return { items: items.map((b) => view(b, counts.get(b.id) ?? 0)), meta: { page, limit, total } }
}

async function load(auth, id) {
  const branch = await Branch.findOne({ _id: id, ...scope(auth) }).populate('manager', 'name')
  if (!branch) throw ApiError.notFound('Branch not found')
  return branch
}

export async function getBranch(auth, id) {
  const branch = await load(auth, id)
  return view(branch, (await countsFor(auth, [branch._id])).get(branch.id) ?? 0)
}

export async function updateBranch(auth, id, patch) {
  const branch = await load(auth, id)
  if (patch.manager) await checkManager(auth, patch.manager)
  if (patch.status === 'inactive' && branch.status === 'active') await assertEmpty(auth, branch)
  if (patch.status === 'active') branch.archivedAt = null
  if (patch.status === 'inactive') branch.archivedAt = new Date()
  branch.set(patch)
  try { await branch.save() } catch (err) { throw err.code === 11000 ? ApiError.conflict('A branch with this code already exists') : err }
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'branch.updated', entity: { type: 'Branch', id: branch._id }, metadata: { fields: Object.keys(patch) } })
  return view(branch, (await countsFor(auth, [branch._id])).get(branch.id) ?? 0)
}

async function assertEmpty(auth, branch) {
  const n = await Membership.countDocuments({ organization: auth.orgId, branch: branch._id, status: 'active' })
  if (n > 0) throw ApiError.conflict(`Move or remove the ${n} active employee${n === 1 ? '' : 's'} in this branch first`)
}

// Archive (soft delete). Properties and leads linked to the branch will be added to this check in later phases.
export async function archiveBranch(auth, id) {
  const branch = await load(auth, id)
  await assertEmpty(auth, branch)
  branch.status = 'inactive'
  branch.archivedAt = new Date()
  await branch.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'branch.archived', entity: { type: 'Branch', id: branch._id } })
}
