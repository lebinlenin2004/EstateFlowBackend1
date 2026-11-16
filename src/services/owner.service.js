import Property from '../models/Property.js'
import PropertyOwner from '../models/PropertyOwner.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { audit } from './audit.service.js'

const view = (o, propertyCount) => ({ id: o.id, name: o.name, email: o.email ?? null, phone: o.phone, address: o.address ?? {}, notes: o.notes ?? null, propertyCount, archived: !!o.archivedAt, createdAt: o.createdAt })

async function counts(ids) {
  const rows = await Property.aggregate([{ $match: { owner: { $in: ids }, archivedAt: null } }, { $group: { _id: '$owner', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}
async function load(id, archived = false) {
  const o = await PropertyOwner.findOne({ _id: id, archivedAt: archived ? { $ne: null } : null })
  if (!o) throw ApiError.notFound('Property owner not found')
  return o
}

export async function createOwner(auth, body) {
  const o = await PropertyOwner.create({ ...body, createdBy: auth.userId })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'owner.created', entity: { type: 'PropertyOwner', id: o._id } })
  return view(o, 0)
}
export async function listOwners(auth, { page, limit, search, archived }) {
  const f = { archivedAt: archived ? { $ne: null } : null }
  if (search) { const rx = new RegExp(escapeRegex(search), 'i'); f.$or = [{ name: rx }, { email: rx }, { phone: rx }] }
  const [items, total] = await Promise.all([PropertyOwner.find(f).sort('name').skip((page - 1) * limit).limit(limit), PropertyOwner.countDocuments(f)])
  const c = await counts(items.map((o) => o._id))
  return { items: items.map((o) => view(o, c.get(o.id) ?? 0)), meta: { page, limit, total } }
}
export async function getOwner(auth, id) { const o = await load(id); return view(o, (await counts([o._id])).get(o.id) ?? 0) }
export async function updateOwner(auth, id, patch) {
  const o = await load(id)
  for (const [k, v] of Object.entries(patch)) k === 'address' ? Object.entries(v).forEach(([a, b]) => o.set(`address.${a}`, b)) : o.set(k, v)
  await o.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'owner.updated', entity: { type: 'PropertyOwner', id: o._id }, metadata: { fields: Object.keys(patch) } })
  return view(o, (await counts([o._id])).get(o.id) ?? 0)
}
export async function archiveOwner(auth, id) {
  const o = await load(id)
  const n = await Property.countDocuments({ owner: o._id, archivedAt: null })
  if (n > 0) throw ApiError.conflict(`Reassign or archive this owner's ${n} propert${n === 1 ? 'y' : 'ies'} first`)
  o.archivedAt = new Date()
  await o.save()
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'owner.archived', entity: { type: 'PropertyOwner', id: o._id } })
}
