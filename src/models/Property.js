import mongoose from 'mongoose'
import { tenantScope } from './plugins/tenantScope.js'
import { PROPERTY_TYPES, LISTING_TYPES, PROPERTY_STATUSES, AREA_UNITS } from '../constants/property.js'
const { Schema } = mongoose
const schema = new Schema({
  code: { type: String, required: true },
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, maxlength: 5000 },
  propertyType: { type: String, enum: PROPERTY_TYPES, required: true },
  listingType: { type: String, enum: LISTING_TYPES, required: true },
  status: { type: String, enum: PROPERTY_STATUSES, default: 'available' },
  owner: { type: Schema.Types.ObjectId, ref: 'PropertyOwner', default: null },
  address: { line1: String, locality: String, city: { type: String, required: true, trim: true }, state: String, country: { type: String, default: 'India' }, postalCode: String },
  location: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } }, // GeoJSON [lng, lat]
  specs: { bedrooms: Number, bathrooms: Number, area: Number, areaUnit: { type: String, enum: AREA_UNITS, default: 'sqft' } },
  priceMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  currency: { type: String, default: 'INR' },
  amenities: { type: [String], validate: (v) => v.length <= 40 },
  images: { type: [{ url: String, key: String, size: Number, isCover: { type: Boolean, default: false }, uploadedAt: { type: Date, default: Date.now } }], validate: (v) => v.length <= 20 },
  assignedAgent: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  featured: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
schema.plugin(tenantScope)
schema.index({ organization: 1, code: 1 }, { unique: true })
schema.index({ organization: 1, archivedAt: 1, status: 1, listingType: 1, priceMinor: 1 })
schema.index({ organization: 1, propertyType: 1, 'address.city': 1 })
schema.index({ organization: 1, assignedAgent: 1 })
schema.index({ organization: 1, owner: 1 })
schema.index({ location: '2dsphere' }, { sparse: true })
export default mongoose.model('Property', schema)
