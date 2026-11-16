import mongoose from 'mongoose'
const { Schema } = mongoose
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  address: { line1: String, city: String, state: String, country: String, postalCode: String },
  logo: String,
  website: String,
  registrationNumber: String,
  plan: { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
  status: { type: String, enum: ['active', 'suspended', 'inactive'], default: 'active', index: true },
  settings: {
    currency: { type: String, default: 'INR' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    visitDurationMinutes: { type: Number, default: 60 },
    leadAutoAssign: { type: Boolean, default: false },
    notifications: {
      email: { type: Boolean, default: true }, inApp: { type: Boolean, default: true },
      followUpReminders: { type: Boolean, default: true }, siteVisitReminders: { type: Boolean, default: true },
      agreementExpiryAlerts: { type: Boolean, default: true }, rentPaymentReminders: { type: Boolean, default: true },
    },
  },
}, { timestamps: true })
export default mongoose.model('Organization', schema)
