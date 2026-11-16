import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { DEAL_TYPES } from '../constants/crm.js'
const { Schema } = mongoose
// Created when a lead converts. Phase 5 commissions hang off this record.
const schema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  property: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: DEAL_TYPES, required: true },
  valueMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  closedAt: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, lead: 1 }, { unique: true })
schema.index({ organization: 1, closedAt: -1 })
schema.index({ organization: 1, assignedAgent: 1, closedAt: -1 })
export default mongoose.model('Deal', schema)
