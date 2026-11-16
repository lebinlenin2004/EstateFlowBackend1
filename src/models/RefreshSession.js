import mongoose from 'mongoose'
const { Schema } = mongoose
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
  membership: { type: Schema.Types.ObjectId, ref: 'Membership', default: null },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  userAgent: String,
  ip: String,
}, { timestamps: true })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }) // MongoDB deletes expired sessions
export default mongoose.model('RefreshSession', schema)
