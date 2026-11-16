import mongoose from 'mongoose'
import { TENANT_ROLES } from '../constants/roles.js'
const { Schema } = mongoose
// Auth-layer model: queried by user across organizations at login, so it is filtered explicitly
// (not through the tenantScope plugin).
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  role: { type: String, enum: TENANT_ROLES, required: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  status: { type: String, enum: ['active', 'inactive', 'removed'], default: 'active' },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.index({ user: 1, organization: 1 }, { unique: true })
schema.index({ organization: 1, role: 1 })
export default mongoose.model('Membership', schema)
