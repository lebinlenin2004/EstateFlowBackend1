import Organization from '../models/Organization.js'
import Membership from '../models/Membership.js'
import Branch from '../models/Branch.js'
import { ApiError } from '../utils/ApiError.js'
import { detectImageType } from '../utils/fileSignature.js'
import { savePublicFile, deletePublicFile } from './storage.service.js'
import { audit } from './audit.service.js'

// { address: { city: 'X' } } -> { 'address.city': 'X' } so partial updates merge instead of overwriting.
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(flatten(v, `${prefix}${k}.`)) : [[`${prefix}${k}`, v]])

const view = (o) => ({ id: o.id, name: o.name, email: o.email, phone: o.phone ?? null, website: o.website ?? null, registrationNumber: o.registrationNumber ?? null,
  address: o.address ?? {}, logo: o.logo ?? null, plan: o.plan, status: o.status, settings: o.settings, createdAt: o.createdAt })

async function load(auth) {
  const org = await Organization.findById(auth.orgId)
  if (!org) throw ApiError.notFound('Organization not found')
  return org
}

export async function getOrganization(auth) {
  const [org, employees, branches] = await Promise.all([
    load(auth),
    Membership.countDocuments({ organization: auth.orgId, status: 'active' }),
    Branch.countDocuments({ status: 'active' }),
  ])
  return { ...view(org), usage: { employees, branches } }
}

export async function updateOrganization(auth, patch) {
  if (patch.email && (await Organization.exists({ email: patch.email, _id: { $ne: auth.orgId } }))) throw ApiError.conflict('Another organization already uses this email')
  const org = await Organization.findByIdAndUpdate(auth.orgId, { $set: Object.fromEntries(flatten(patch)) }, { new: true, runValidators: true })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'organization.updated', metadata: { fields: Object.keys(patch) } })
  return view(org)
}

export async function getSettings(auth) { return (await load(auth)).settings }

export async function updateSettings(auth, patch) {
  const org = await Organization.findByIdAndUpdate(auth.orgId, { $set: Object.fromEntries(flatten(patch, 'settings.')) }, { new: true, runValidators: true })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'organization.settings_updated', metadata: { fields: Object.keys(patch) } })
  return org.settings
}

export async function uploadLogo(auth, file) {
  if (!file) throw ApiError.badRequest('Attach an image in the "logo" field')
  const type = detectImageType(file.buffer)
  if (!type) throw ApiError.badRequest('Logo must be a PNG, JPEG or WebP image')
  const org = await load(auth)
  const saved = await savePublicFile({ orgId: auth.orgId, folder: 'logo', buffer: file.buffer, ext: type.ext })
  const previous = org.logo
  org.logo = saved.url
  await org.save()
  await deletePublicFile(previous)
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'organization.logo_updated' })
  return { logo: saved.url }
}
