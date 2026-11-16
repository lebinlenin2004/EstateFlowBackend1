import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { CUSTOMER_TYPES, PROPERTY_TYPES, LISTING_TYPES } from '../constants/property.js'
const { Schema } = mongoose
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, lowercase: true, trim: true },
  phone: { type: String, required: true },
  alternatePhone: String,
  customerType: { type: String, enum: CUSTOMER_TYPES, default: 'buyer' },
  address: { line1: String, city: String, state: String, country: String, postalCode: String },
  requirements: { type: String, maxlength: 2000 },
  budget: { minMinor: { type: Number, min: 0 }, maxMinor: { type: Number, min: 0 } },
  preferredLocations: { type: [String], validate: (v) => v.length <= 10 },
  preferences: { propertyTypes: [{ type: String, enum: PROPERTY_TYPES }], listingType: { type: String, enum: LISTING_TYPES }, bedrooms: Number },
  notes: { type: String, maxlength: 2000 },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  archivedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, phone: 1 })
schema.index({ organization: 1, assignedAgent: 1, archivedAt: 1 })
schema.index({ organization: 1, archivedAt: 1, createdAt: -1 })
export default mongoose.model('Customer', schema)
