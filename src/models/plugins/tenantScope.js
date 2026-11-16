import mongoose from 'mongoose'
import { getTenantId } from '../../utils/tenantContext.js'

const QUERY_OPS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments']

function requireTenant() {
  const id = getTenantId()
  if (!id) throw new Error('Tenant context missing: tenant-scoped data cannot be accessed outside an authenticated organization request')
  return id
}

/**
 * Apply to every organization-owned schema. Adds a required `organization` field and forces it into
 * every query, update, delete, aggregate and insert. It fails closed when there is no tenant context.
 * System jobs that must span tenants opt out explicitly with .setOptions({ skipTenant: true }).
 */
export function tenantScope(schema) {
  schema.add({ organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true } })

  const scopeQuery = function scopeQuery() {
    if (this.getOptions().skipTenant) return
    this.where({ organization: requireTenant() })
  }
  QUERY_OPS.forEach((op) => schema.pre(op, scopeQuery))

  const stamp = (doc) => {
    const id = requireTenant()
    if (doc.organization && String(doc.organization) !== String(id)) throw new Error('Cross-tenant write blocked')
    doc.organization = id
  }
  // 'validate' (not 'save') so the organization is set before the required-field check runs
  schema.pre('validate', function preValidate() { if (this.isNew) stamp(this) })
  schema.pre('insertMany', function preInsertMany(next, docs) {
    try { (Array.isArray(docs) ? docs : [docs]).forEach(stamp); next() } catch (err) { next(err) }
  })
  schema.pre('aggregate', function preAggregate() {
    if (this.options?.skipTenant) return
    this.pipeline().unshift({ $match: { organization: new mongoose.Types.ObjectId(String(requireTenant())) } })
  })
}
