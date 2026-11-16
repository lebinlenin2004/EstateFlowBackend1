import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: { line1: String, city: String, state: String, country: String, postalCode: String },
  notes: { type: String, maxlength: 2000 },
  archivedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, archivedAt: 1, name: 1 })
export default mongoose.model('PropertyOwner', schema)
