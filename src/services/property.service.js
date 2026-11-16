import mongoose from 'mongoose'
import Property from '../models/Property.js'
import PropertyOwner from '../models/PropertyOwner.js'
import PropertyHistory from '../models/PropertyHistory.js'
import Branch from '../models/Branch.js'
import { nextSequence } from '../models/Counter.js'
import { ApiError } from '../utils/ApiError.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import { toMinor, fromMinor } from '../utils/money.js'
import { detectImageType } from '../utils/fileSignature.js'
import { ROLES } from '../constants/roles.js'
import { hasPermission } from '../constants/permissions.js'
import { savePublicFile, deletePublicFile } from './storage.service.js'
import { assertAssignableAgent } from './agent.service.js'
import Lead from '../models/Lead.js'
import SiteVisit from '../models/SiteVisit.js'
import { agentScope } from './scope.service.js'
import { audit } from './audit.service.js'

const SORTS = { newest: { createdAt: -1, _id: -1 }, oldest: { createdAt: 1, _id: 1 }, price_asc: { priceMinor: 1, _id: 1 }, price_desc: { priceMinor: -1, _id: 1 }, area_desc: { 'specs.area': -1, _id: 1 } }
const SOLD_FOR = { sale: 'sold', rent: 'rented', lease: 'rented' }
const MAX_IMAGES = 20

// Branch managers only see and manage their own branch's properties. Tenant scoping itself is done by the model plugin.
const scope = (auth) => {
  if (auth.role !== ROLES.BRANCH_MANAGER) return {}
  if (!auth.branchId) throw ApiError.forbidden('You are not assigned to a branch')
  return { branch: auth.branchId }
}
const withRefs = (q) => q.populate('owner', 'name phone email').populate('assignedAgent', 'name').populate('branch', 'name code')
const idName = (d) => (d ? { id: String(d._id), name: d.name ?? null } : null)

function view(p, auth, full = false) {
  const cover = p.images.find((i) => i.isCover) ?? p.images[0]
  const seeContact = hasPermission(auth.role, 'owner:manage')
  const out = {
    id: p.id, code: p.code, title: p.title, description: p.description ?? null, propertyType: p.propertyType, listingType: p.listingType, status: p.status, featured: p.featured,
    address: p.address ?? {}, location: p.location?.coordinates?.length === 2 ? { latitude: p.location.coordinates[1], longitude: p.location.coordinates[0] } : null,
    specs: { bedrooms: p.specs?.bedrooms ?? null, bathrooms: p.specs?.bathrooms ?? null, area: p.specs?.area ?? null, areaUnit: p.specs?.areaUnit },
    price: fromMinor(p.priceMinor), priceMinor: p.priceMinor, currency: p.currency, amenities: p.amenities,
    coverImage: cover?.url ?? null, imageCount: p.images.length,
    owner: p.owner ? { ...idName(p.owner), ...(seeContact ? { phone: p.owner.phone ?? null, email: p.owner.email ?? null } : {}) } : null,
    assignedAgent: idName(p.assignedAgent), branch: p.branch ? { id: String(p.branch._id), name: p.branch.name, code: p.branch.code } : null,
    archived: !!p.archivedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
  }
  if (full) out.images = p.images.map((i) => ({ id: i.id, url: i.url, isCover: i.isCover || i === cover, uploadedAt: i.uploadedAt }))
  return out
}

const snapshot = (p) => ({ title: p.title, description: p.description ?? null, propertyType: p.propertyType, listingType: p.listingType, featured: p.featured, priceMinor: p.priceMinor, currency: p.currency,
  owner: p.owner ? String(p.owner._id ?? p.owner) : null, branch: p.branch ? String(p.branch._id ?? p.branch) : null, city: p.address?.city ?? null, locality: p.address?.locality ?? null,
  bedrooms: p.specs?.bedrooms ?? null, bathrooms: p.specs?.bathrooms ?? null, area: p.specs?.area ?? null, areaUnit: p.specs?.areaUnit ?? null, amenities: (p.amenities ?? []).join(',') })
function diff(a, b) {
  const out = {}
  for (const k of Object.keys(b)) if (a[k] !== b[k]) out[k] = k === 'description' ? 'edited' : [a[k], b[k]]
  return out
}
const record = (auth, property, action, changes) => PropertyHistory.create({ property, actor: auth.userId, action, changes })

async function load(auth, id, { archived = false } = {}) {
  const p = await withRefs(Property.findOne({ _id: id, archivedAt: archived ? { $ne: null } : null, ...scope(auth) }))
  if (!p) throw ApiError.notFound('Property not found')
  return p
}
const assertOwner = async (ownerId) => { if (!(await PropertyOwner.exists({ _id: ownerId, archivedAt: null }))) throw ApiError.badRequest('That property owner does not exist') }
async function resolveBranch(auth, branchId) {
  if (auth.role === ROLES.BRANCH_MANAGER) {
    if (branchId && branchId !== auth.branchId) throw ApiError.forbidden('You can only use your own branch')
    return auth.branchId
  }
  if (!branchId) return null
  if (!(await Branch.exists({ _id: branchId, status: 'active' }))) throw ApiError.badRequest('That branch does not exist or is inactive')
  return branchId
}
const geo = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] })

export async function createProperty(auth, body) {
  const { ownerId, branchId, latitude, longitude, price, bedrooms, bathrooms, area, areaUnit, ...rest } = body
  if (ownerId) await assertOwner(ownerId)
  const branch = await resolveBranch(auth, branchId)
  const code = `PR-${String(await nextSequence(auth.orgId, 'property')).padStart(4, '0')}`
  const p = await Property.create({ ...rest, code, owner: ownerId ?? null, branch, priceMinor: toMinor(price), specs: { bedrooms, bathrooms, area, areaUnit },
    ...(latitude !== undefined ? { location: geo(latitude, longitude) } : {}), createdBy: auth.userId, updatedBy: auth.userId })
  await record(auth, p._id, 'created')
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'property.created', entity: { type: 'Property', id: p._id } })
  return view(await load(auth, p.id), auth, true)
}

export async function updateProperty(auth, id, body) {
  const p = await load(auth, id)
  const before = snapshot(p)
  const { ownerId, branchId, latitude, longitude, price, bedrooms, bathrooms, area, areaUnit, address, ...rest } = body
  if (ownerId) await assertOwner(ownerId)
  p.set(rest)
  if (ownerId !== undefined) p.owner = ownerId
  if (branchId !== undefined) p.branch = await resolveBranch(auth, branchId)
  if (price !== undefined) p.priceMinor = toMinor(price)
  if (latitude !== undefined) p.location = geo(latitude, longitude)
  if (address) for (const [k, v] of Object.entries(address)) p.set(`address.${k}`, v)
  for (const [k, v] of Object.entries({ bedrooms, bathrooms, area, areaUnit })) if (v !== undefined) p.set(`specs.${k}`, v)
  p.updatedBy = auth.userId
  await p.save()
  const changes = diff(before, snapshot(p))
  if (Object.keys(changes).length) await record(auth, p._id, 'updated', changes)
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'property.updated', entity: { type: 'Property', id: p._id }, metadata: { fields: Object.keys(changes) } })
  return view(await load(auth, id), auth, true)
}

export async function getProperty(auth, id) { return view(await load(auth, id), auth, true) }

function buildFilter(auth, q) {
  const f = { archivedAt: q.archived ? { $ne: null } : null, ...scope(auth) }
  for (const k of ['propertyType', 'listingType', 'status']) if (q[k]) f[k] = q[k]
  if (q.city) f['address.city'] = new RegExp(`^${escapeRegex(q.city)}$`, 'i')
  if (q.minPrice || q.maxPrice) f.priceMinor = { ...(q.minPrice && { $gte: toMinor(q.minPrice) }), ...(q.maxPrice && { $lte: toMinor(q.maxPrice) }) }
  if (q.bedrooms !== undefined) f['specs.bedrooms'] = { $gte: q.bedrooms }
  if (q.bathrooms !== undefined) f['specs.bathrooms'] = { $gte: q.bathrooms }
  if (q.minArea || q.maxArea) f['specs.area'] = { ...(q.minArea && { $gte: q.minArea }), ...(q.maxArea && { $lte: q.maxArea }) }
  if (q.amenities?.length) f.amenities = { $all: q.amenities }
  if (q.assignedAgent) f.assignedAgent = q.assignedAgent
  if (q.branchId && auth.role !== ROLES.BRANCH_MANAGER) f.branch = q.branchId
  if (q.featured !== undefined) f.featured = q.featured
  if (q.lat !== undefined) f.location = { $geoWithin: { $centerSphere: [[q.lng, q.lat], q.radiusKm / 6378.1] } } // works with counts, unlike $near
  if (q.search) { const rx = new RegExp(escapeRegex(q.search), 'i'); f.$or = [{ title: rx }, { code: rx }, { 'address.city': rx }, { 'address.locality': rx }, { 'address.line1': rx }] }
  return f
}

export async function listProperties(auth, q) {
  const f = buildFilter(auth, q)
  const [items, total] = await Promise.all([
    withRefs(Property.find(f).sort(SORTS[q.sort]).skip((q.page - 1) * q.limit).limit(q.limit)),
    Property.countDocuments(f),
  ])
  return { items: items.map((p) => view(p, auth)), meta: { page: q.page, limit: q.limit, total } }
}

export async function propertySummary(auth) {
  const match = { archivedAt: null, ...(auth.role === ROLES.BRANCH_MANAGER ? { branch: new mongoose.Types.ObjectId(scope(auth).branch) } : {}) }
  const rows = await Property.aggregate([{ $match: match }, { $group: { _id: { status: '$status', listingType: '$listingType', propertyType: '$propertyType', featured: '$featured' }, n: { $sum: 1 } } }])
  const out = { total: 0, featured: 0, byStatus: {}, byListingType: {}, byPropertyType: {} }
  for (const { _id, n } of rows) {
    out.total += n; if (_id.featured) out.featured += n
    out.byStatus[_id.status] = (out.byStatus[_id.status] ?? 0) + n
    out.byListingType[_id.listingType] = (out.byListingType[_id.listingType] ?? 0) + n
    out.byPropertyType[_id.propertyType] = (out.byPropertyType[_id.propertyType] ?? 0) + n
  }
  return out
}

export async function changeStatus(auth, id, { status, note }) {
  const p = await load(auth, id)
  if ((status === 'sold' || status === 'rented') && status !== SOLD_FOR[p.listingType]) throw ApiError.badRequest(`A property listed for ${p.listingType} cannot be marked ${status}`)
  if (p.status === status) return view(p, auth, true)
  const from = p.status
  p.status = status
  p.updatedBy = auth.userId
  await p.save()
  await record(auth, p._id, 'status_changed', { status: [from, status], ...(note ? { note } : {}) })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'property.status_changed', entity: { type: 'Property', id: p._id }, metadata: { from, to: status } })
  return view(p, auth, true)
}

export async function assignAgent(auth, id, agentId) {
  const p = await load(auth, id)
  if (agentId) await assertAssignableAgent(auth, agentId)
  const from = p.assignedAgent ? String(p.assignedAgent._id) : null
  p.assignedAgent = agentId
  p.updatedBy = auth.userId
  await p.save()
  await record(auth, p._id, 'agent_assigned', { assignedAgent: [from, agentId] })
  return view(await load(auth, id), auth, true)
}

export async function archiveProperty(auth, id) {
  const p = await load(auth, id)
  p.archivedAt = new Date()
  p.updatedBy = auth.userId
  await p.save()
  await record(auth, p._id, 'archived')
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'property.archived', entity: { type: 'Property', id: p._id } })
}

export async function restoreProperty(auth, id) {
  const p = await load(auth, id, { archived: true })
  p.archivedAt = null
  await p.save()
  await record(auth, p._id, 'restored')
  return view(await load(auth, id), auth, true)
}

export async function propertyHistory(auth, id, { page, limit }) {
  const p = await withRefs(Property.findOne({ _id: id, ...scope(auth) })) // archived properties keep readable history
  if (!p) throw ApiError.notFound('Property not found')
  const f = { property: p._id }
  const [items, total] = await Promise.all([
    PropertyHistory.find(f).populate('actor', 'name').sort('-createdAt').skip((page - 1) * limit).limit(limit),
    PropertyHistory.countDocuments(f),
  ])
  return { items: items.map((h) => ({ id: h.id, action: h.action, changes: h.changes ?? null, actor: idName(h.actor), at: h.createdAt })), meta: { page, limit, total } }
}

export async function addImages(auth, id, files) {
  if (!files?.length) throw ApiError.badRequest('Attach at least one image in the "images" field')
  const p = await load(auth, id)
  if (p.images.length + files.length > MAX_IMAGES) throw ApiError.badRequest(`A property can have at most ${MAX_IMAGES} images (it has ${p.images.length})`)
  const typed = files.map((f) => ({ f, type: detectImageType(f.buffer) }))
  const bad = typed.find((t) => !t.type)
  if (bad) throw ApiError.badRequest(`"${bad.f.originalname}" is not a PNG, JPEG or WebP image`) // validate all before storing any
  const saved = []
  try {
    for (const { f, type } of typed) saved.push({ ...(await savePublicFile({ orgId: auth.orgId, folder: `properties/${p.id}`, buffer: f.buffer, ext: type.ext })), size: f.size })
    saved.forEach((s, i) => p.images.push({ url: s.url, key: s.key, size: s.size, isCover: p.images.length === 0 && i === 0 }))
    p.updatedBy = auth.userId
    await p.save()
  } catch (err) { await Promise.all(saved.map((s) => deletePublicFile(s.url))); throw err }
  await record(auth, p._id, 'images_added', { count: saved.length })
  return view(p, auth, true)
}

export async function removeImage(auth, id, imageId) {
  const p = await load(auth, id)
  const img = p.images.id(imageId)
  if (!img) throw ApiError.notFound('Image not found')
  const { url, isCover } = img
  img.deleteOne()
  if (isCover && p.images.length) p.images[0].isCover = true
  await p.save()
  await deletePublicFile(url)
  await record(auth, p._id, 'image_removed')
  return view(p, auth, true)
}

export async function setCover(auth, id, imageId) {
  const p = await load(auth, id)
  if (!p.images.id(imageId)) throw ApiError.notFound('Image not found')
  p.images.forEach((i) => { i.isCover = i.id === imageId })
  await p.save()
  return view(p, auth, true)
}

/** Who is interested in this property and who has visited it. Agents only see their own leads and visits. */
export async function propertyInterest(auth, id) {
  const p = await load(auth, id)
  const s = await agentScope(auth)
  const [leads, visits] = await Promise.all([
    Lead.find({ interestedProperties: p._id, archivedAt: null, ...s }).sort('-createdAt').limit(50).populate('customer', 'name phone').populate('assignedAgent', 'name'),
    SiteVisit.find({ property: p._id, ...s }).sort('-startAt').limit(50).populate('customer', 'name').populate('assignedAgent', 'name'),
  ])
  return {
    interestedLeads: leads.map((l) => ({ id: l.id, code: l.code, status: l.status, customer: l.customer ? { id: String(l.customer._id), name: l.customer.name, phone: l.customer.phone } : null, assignedAgent: l.assignedAgent?.name ?? null })),
    siteVisits: visits.map((v) => ({ id: v.id, status: v.status, startAt: v.startAt, customer: v.customer?.name ?? null, assignedAgent: v.assignedAgent?.name ?? null, feedback: v.feedback?.recordedAt ? { rating: v.feedback.rating ?? null, comment: v.feedback.comment ?? null, interested: v.feedback.interested ?? null } : null })),
  }
}
