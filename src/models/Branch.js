import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
const { Schema } = mongoose
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, uppercase: true, trim: true },
  address: { line1: String, city: String, state: String, country: String, postalCode: String },
  phone: String,
  email: { type: String, lowercase: true, trim: true },
  manager: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  archivedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, code: 1 }, { unique: true })
schema.index({ organization: 1, status: 1, name: 1 })
export default mongoose.model('Branch', schema)
