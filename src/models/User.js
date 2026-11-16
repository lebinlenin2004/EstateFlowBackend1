import mongoose from 'mongoose'
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, trim: true },
  isPlatformAdmin: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  passwordChangedAt: Date,
  lastLoginAt: Date,
}, { timestamps: true })
schema.set('toJSON', { transform: (_d, ret) => { delete ret.passwordHash; delete ret.__v; return ret } })
export default mongoose.model('User', schema)
