import User from '../models/User.js'
import Membership from '../models/Membership.js'
import Organization from '../models/Organization.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyAccessToken } from '../utils/tokens.js'
import { runWithTenant } from '../utils/tenantContext.js'
import { hasPermission } from '../constants/permissions.js'
import { ROLES } from '../constants/roles.js'

/** Verifies the access token, re-checks the user, membership and organization in the database
 *  (so deactivation takes effect immediately), and opens the tenant context for the rest of the request. */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized()
  const payload = verifyAccessToken(header.slice(7))
  const [user, membership, org] = await Promise.all([
    User.findById(payload.sub),
    payload.org ? Membership.findOne({ _id: payload.mid, user: payload.sub, organization: payload.org, status: 'active' }) : null,
    payload.org ? Organization.findById(payload.org).select('status') : null,
  ])
  if (!user || user.status !== 'active') throw ApiError.unauthorized()
  if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) throw ApiError.unauthorized('Session expired. Log in again.')
  if (payload.org) {
    if (!membership) throw ApiError.unauthorized('Your access to this organization has ended')
    if (org?.status !== 'active') throw ApiError.forbidden('This organization is not active')
  } else if (!user.isPlatformAdmin) throw ApiError.unauthorized()

  req.auth = { userId: user.id, orgId: payload.org ?? null, membershipId: membership?.id ?? null,
    role: membership?.role ?? ROLES.SUPER_ADMIN, branchId: membership?.branch ? String(membership.branch) : null }
  runWithTenant({ orgId: req.auth.orgId }, next)
})

/** Allow when the caller's role holds at least one of the listed permissions. Always enforced server-side. */
export const authorize = (...permissions) => (req, _res, next) => {
  if (!req.auth) return next(ApiError.unauthorized())
  next(permissions.some((p) => hasPermission(req.auth.role, p)) ? undefined : ApiError.forbidden())
}

export const requireOrganization = (req, _res, next) =>
  next(req.auth?.orgId ? undefined : ApiError.forbidden('This action needs an organization context'))
