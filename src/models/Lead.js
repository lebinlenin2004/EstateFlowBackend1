import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCES } from '../constants/crm.js'
import { PROPERTY_TYPES } from '../constants/property.js'
const { Schema } = mongoose
const schema = new Schema({
  code: { type: String, required: true },
  title: { type: String, required: true, trim: true, maxlength: 150 },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  source: { type: String, enum: LEAD_SOURCES, default: 'phone' },
  requirements: { type: String, maxlength: 2000 },
  budget: { minMinor: { type: Number, min: 0 }, maxMinor: { type: Number, min: 0 } },
  preferredLocations: { type: [String], validate: (v) => v.length <= 10 },
  propertyType: { type: String, enum: PROPERTY_TYPES },
  interestedProperties: { type: [{ type: Schema.Types.ObjectId, ref: 'Property' }], validate: (v) => v.length <= 10 },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  priority: { type: String, enum: LEAD_PRIORITIES, default: 'medium' },
  status: { type: String, enum: LEAD_STATUSES, default: 'new' },
  lostReason: { type: String, maxlength: 300 },
  lastInteractionAt: { type: Date, default: Date.now },
  convertedAt: Date,
  deal: { type: Schema.Types.ObjectId, ref: 'Deal', default: null },
  archivedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, code: 1 }, { unique: true })
schema.index({ organization: 1, archivedAt: 1, status: 1, assignedAgent: 1 })
schema.index({ organization: 1, archivedAt: 1, createdAt: -1 })
schema.index({ organization: 1, customer: 1 })
schema.index({ organization: 1, interestedProperties: 1 })
export default mongoose.model('Lead', schema)
