import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { VISIT_STATUSES } from '../constants/crm.js'
const { Schema } = mongoose
const schema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  status: { type: String, enum: VISIT_STATUSES, default: 'scheduled' },
  notes: { type: String, maxlength: 1000 },
  feedback: { rating: { type: Number, min: 1, max: 5 }, comment: { type: String, maxlength: 1000 }, interested: Boolean, recordedAt: Date },
  cancelReason: { type: String, maxlength: 300 },
  completedAt: Date,
  rescheduledCount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, assignedAgent: 1, startAt: 1 })
schema.index({ organization: 1, property: 1, startAt: 1 })
schema.index({ organization: 1, customer: 1, startAt: -1 })
schema.index({ organization: 1, status: 1, startAt: 1 })
export default mongoose.model('SiteVisit', schema)
