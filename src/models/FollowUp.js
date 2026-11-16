import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { FOLLOWUP_TYPES, FOLLOWUP_STATUSES, LEAD_PRIORITIES } from '../constants/crm.js'
const { Schema } = mongoose
const schema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  dueAt: { type: Date, required: true },
  type: { type: String, enum: FOLLOWUP_TYPES, default: 'call' },
  priority: { type: String, enum: LEAD_PRIORITIES, default: 'medium' },
  notes: { type: String, maxlength: 1000 },
  status: { type: String, enum: FOLLOWUP_STATUSES, default: 'pending' },
  completedAt: Date,
  completionNote: { type: String, maxlength: 1000 },
  cancelReason: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, assignedAgent: 1, status: 1, dueAt: 1 })
schema.index({ organization: 1, status: 1, dueAt: 1 })
schema.index({ organization: 1, lead: 1, dueAt: -1 })
export default mongoose.model('FollowUp', schema)
