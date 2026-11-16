import { z } from 'zod'
import { TENANT_ROLES } from '../constants/roles.js'

const email = z.string().trim().toLowerCase().email('Enter a valid email')
const name = z.string().trim().min(2, 'Enter at least 2 characters').max(100)
const phone = z.string().trim().max(20).optional()
export const password = z.string().min(8, 'Use at least 8 characters').max(72, 'Use 72 characters or fewer')
  .regex(/[a-z]/, 'Include a lowercase letter').regex(/[A-Z]/, 'Include an uppercase letter').regex(/\d/, 'Include a number')
const token = z.string().min(20).max(200)
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

export const registerSchema = { body: z.object({ organizationName: name, name, email, phone, password }) }
export const loginSchema = { body: z.object({ email, password: z.string().min(1, 'Enter your password'), organizationId: objectId.optional() }) }
export const forgotPasswordSchema = { body: z.object({ email }) }
export const resetPasswordSchema = { body: z.object({ token, password }) }
export const changePasswordSchema = { body: z.object({ currentPassword: z.string().min(1), newPassword: password }) }
export const updateProfileSchema = { body: z.object({ name: name.optional(), phone: z.string().trim().max(20).nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Provide at least one field') }
export const acceptInvitationSchema = { body: z.object({ token, name: name.optional(), password }) }
export const inviteSchema = { body: z.object({ email, role: z.enum(TENANT_ROLES), branchId: objectId.optional() }) }
export const listMembersSchema = { query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }) }
