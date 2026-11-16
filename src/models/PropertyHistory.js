import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
const { Schema } = mongoose
const schema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  changes: { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } })
schema.plugin(tenantScope)
schema.index({ property: 1, createdAt: -1 })
export default mongoose.model('PropertyHistory', schema)
