import mongoose from 'mongoose'
const { Schema } = mongoose
const schema = new Schema({
  organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true },
  entity: { type: { type: String }, id: Schema.Types.ObjectId },
  metadata: Schema.Types.Mixed,
  ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } })
schema.index({ organization: 1, createdAt: -1 })
export default mongoose.model('AuditLog', schema)
