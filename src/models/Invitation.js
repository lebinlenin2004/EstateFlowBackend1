import mongoose from 'mongoose'
import { TENANT_ROLES } from '../constants/roles.js'
const { Schema } = mongoose
const schema = new Schema({
  organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: TENANT_ROLES, required: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  acceptedAt: Date,
}, { timestamps: true })
schema.index({ organization: 1, email: 1 })
export default mongoose.model('Invitation', schema)
