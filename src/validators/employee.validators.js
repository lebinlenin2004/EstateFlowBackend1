import { z } from 'zod'
import { TENANT_ROLES } from '../constants/roles.js'
import { objectId, pagination, nonEmpty } from './common.js'

export const listEmployeesSchema = { query: z.object({ ...pagination, search: z.string().trim().max(100).optional(),
  role: z.enum(TENANT_ROLES).optional(), status: z.enum(['active', 'inactive']).optional(), branchId: objectId.optional() }) }
export const updateEmployeeSchema = { body: z.object({ role: z.enum(TENANT_ROLES), branchId: objectId.nullable() }).partial().refine(nonEmpty, 'Provide a role or branch') }
export const employeeStatusSchema = { body: z.object({ status: z.enum(['active', 'inactive']) }) }
