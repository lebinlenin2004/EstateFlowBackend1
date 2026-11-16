import mongoose from 'mongoose'
const { Schema } = mongoose
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true })
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export default mongoose.model('PasswordResetToken', schema)
