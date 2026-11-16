import Membership from '../models/Membership.js'
import { ApiError } from '../utils/ApiError.js'
import { ROLES } from '../constants/roles.js'

export const ASSIGNABLE_ROLES = [ROLES.OWNER, ROLES.BRANCH_MANAGER, ROLES.PROPERTY_MANAGER, ROLES.SALES_AGENT]

/** Throws unless `userId` is an active member of the caller's organization who may be assigned work,
 *  and the caller is allowed to assign them. Shared by properties, customers and (later) leads. */
export async function assertAssignableAgent(auth, userId) {
  if (auth.role === ROLES.SALES_AGENT && userId !== auth.userId) throw ApiError.forbidden('You can only assign records to yourself')
  const m = await Membership.findOne({ user: userId, organization: auth.orgId, status: 'active', role: { $in: ASSIGNABLE_ROLES } })
  if (!m) throw ApiError.badRequest('That person is not an active team member who can be assigned')
  if (auth.role === ROLES.BRANCH_MANAGER && String(m.branch) !== auth.branchId) throw ApiError.forbidden('You can only assign people from your own branch')
}
