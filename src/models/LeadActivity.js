import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { ACTIVITY_TYPES } from '../constants/crm.js'
const { Schema } = mongoose
// Separate collection: a lead's history is unbounded and must never live inside the lead document.
const schema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ACTIVITY_TYPES, required: true },
  summary: { type: String, maxlength: 1000 },
  data: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } })
schema.plugin(tenantScope)
schema.index({ lead: 1, createdAt: -1 })
schema.index({ customer: 1, createdAt: -1 })
export default mongoose.model('LeadActivity', schema)
