import { z } from 'zod'
import { CUSTOMER_TYPES, PROPERTY_TYPES, LISTING_TYPES } from '../constants/property.js'
import { objectId, pagination, nonEmpty } from './common.js'
import { money } from './property.validators.js'
import { normalizePhone, isValidPhone } from '../utils/phone.js'

const str = (max) => z.string().trim().max(max)
const phone = z.string().transform(normalizePhone).refine(isValidPhone, 'Enter a valid phone number (7-15 digits)')
const budget = z.object({ min: money.optional(), max: money.optional() }).strict().refine((b) => !(b.min && b.max) || b.min <= b.max, 'Minimum budget cannot exceed maximum')
const fields = {
  name: str(100).min(2), email: z.string().trim().toLowerCase().email(), phone, alternatePhone: phone, customerType: z.enum(CUSTOMER_TYPES),
  address: z.object({ line1: str(150), city: str(80), state: str(80), country: str(80), postalCode: str(20) }).partial().strict(),
  requirements: str(2000), budget, preferredLocations: z.array(str(80).min(1)).max(10),
  preferences: z.object({ propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(8), listingType: z.enum(LISTING_TYPES), bedrooms: z.number().int().min(0).max(50) }).partial().strict(),
  notes: str(2000), assignedAgentId: objectId,
}
export const createCustomerSchema = { body: z.object(fields).required({ name: true, phone: true }).partial({ email: true, alternatePhone: true, customerType: true, address: true, requirements: true, budget: true, preferredLocations: true, preferences: true, notes: true, assignedAgentId: true }).strict() }
export const updateCustomerSchema = { body: z.object({ ...fields, assignedAgentId: objectId.nullable() }).partial().strict().refine(nonEmpty, 'Provide at least one field') }
export const listCustomersSchema = { query: z.object({ ...pagination, search: str(100).optional(), customerType: z.enum(CUSTOMER_TYPES).optional(), assignedAgent: objectId.optional(),
  location: str(80).optional(), archived: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }) }
