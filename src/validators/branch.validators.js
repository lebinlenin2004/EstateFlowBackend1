import { z } from 'zod'
import { objectId, pagination, nonEmpty } from './common.js'
import { addressSchema } from './organization.validators.js'

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'Use 2-12 letters, numbers or dashes')
const fields = { name: z.string().trim().min(2).max(100), address: addressSchema, phone: z.string().trim().max(20), email: z.string().trim().toLowerCase().email() }
export const createBranchSchema = { body: z.object({ name: fields.name, address: fields.address.optional(), phone: fields.phone.optional(), email: fields.email.optional(), code: code.optional(), manager: objectId.optional() }) }
export const updateBranchSchema = { body: z.object({ ...fields, code, manager: objectId.nullable(), status: z.enum(['active', 'inactive']) }).partial().refine(nonEmpty, 'Provide at least one field') }
export const listBranchesSchema = { query: z.object({ ...pagination, search: z.string().trim().max(100).optional(), status: z.enum(['active', 'inactive']).optional() }) }
