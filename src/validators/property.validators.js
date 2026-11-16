import { z } from 'zod'
import { PROPERTY_TYPES, LISTING_TYPES, PROPERTY_STATUSES, AREA_UNITS } from '../constants/property.js'
import { objectId, pagination, nonEmpty } from './common.js'
import { hasAtMostTwoDecimals } from '../utils/money.js'

const str = (max) => z.string().trim().max(max)
export const money = z.number().positive().max(1e12).refine(hasAtMostTwoDecimals, 'Use at most 2 decimal places')
const amenity = z.string().trim().toLowerCase().min(1).max(50)
const amenities = z.array(amenity).max(40).transform((a) => [...new Set(a)])
const addressBase = z.object({ line1: str(150), locality: str(100), city: str(80).min(1), state: str(80), country: str(80), postalCode: str(20) }).strict()
const address = addressBase.partial().required({ city: true }) // only the city is mandatory
const fields = {
  title: str(150).min(3), description: str(5000), propertyType: z.enum(PROPERTY_TYPES), listingType: z.enum(LISTING_TYPES),
  ownerId: objectId, address, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  bedrooms: z.number().int().min(0).max(50), bathrooms: z.number().int().min(0).max(50), area: z.number().positive().max(1e7), areaUnit: z.enum(AREA_UNITS),
  price: money, currency: z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP']), amenities, featured: z.boolean(), branchId: objectId,
}
const bothOrNeither = (v) => (v.latitude === undefined) === (v.longitude === undefined)
const geoMsg = 'Provide latitude and longitude together'

export const createPropertySchema = { body: z.object(fields).required({ title: true, propertyType: true, listingType: true, address: true, price: true })
  .partial({ description: true, ownerId: true, latitude: true, longitude: true, bedrooms: true, bathrooms: true, area: true, areaUnit: true, currency: true, amenities: true, featured: true, branchId: true })
  .strict().refine(bothOrNeither, geoMsg) }
export const updatePropertySchema = { body: z.object({ ...fields, address: addressBase.partial(), ownerId: objectId.nullable() }).partial().strict().refine(nonEmpty, 'Provide at least one field').refine(bothOrNeither, geoMsg) }
export const statusSchema = { body: z.object({ status: z.enum(PROPERTY_STATUSES), note: str(300).optional() }) }
export const assignSchema = { body: z.object({ agentId: objectId.nullable() }) }

const num = z.coerce.number()
export const listPropertiesSchema = { query: z.object({
  ...pagination, search: str(100).optional(), city: str(80).optional(), propertyType: z.enum(PROPERTY_TYPES).optional(), listingType: z.enum(LISTING_TYPES).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(), minPrice: num.positive().optional(), maxPrice: num.positive().optional(), bedrooms: z.coerce.number().int().min(0).optional(),
  bathrooms: z.coerce.number().int().min(0).optional(), minArea: num.positive().optional(), maxArea: num.positive().optional(),
  amenities: z.string().max(400).optional().transform((s) => (s ? s.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : undefined)),
  assignedAgent: objectId.optional(), branchId: objectId.optional(), featured: z.enum(['true', 'false']).optional().transform((v) => (v ? v === 'true' : undefined)),
  archived: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  lat: num.min(-90).max(90).optional(), lng: num.min(-180).max(180).optional(), radiusKm: num.positive().max(500).optional(),
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'area_desc']).default('newest'),
}).refine((q) => [q.lat, q.lng, q.radiusKm].every((v) => v === undefined) || [q.lat, q.lng, q.radiusKm].every((v) => v !== undefined), 'lat, lng and radiusKm must be sent together')
  .refine((q) => !(q.minPrice && q.maxPrice) || q.minPrice <= q.maxPrice, 'minPrice cannot exceed maxPrice') }
export const imageParams = { params: z.object({ id: objectId, imageId: objectId }) }
export const historySchema = { query: z.object({ ...pagination }) }

const phone = z.string().trim().max(20)
export const ownerBody = { name: str(120).min(2), email: z.string().trim().toLowerCase().email(), phone, address: addressBase.partial(), notes: str(2000) }
export const createOwnerSchema = { body: z.object(ownerBody).required({ name: true, phone: true }).partial({ email: true, address: true, notes: true }).strict() }
export const updateOwnerSchema = { body: z.object(ownerBody).partial().strict().refine(nonEmpty, 'Provide at least one field') }
export const listOwnersSchema = { query: z.object({ ...pagination, search: str(100).optional(), archived: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }) }
