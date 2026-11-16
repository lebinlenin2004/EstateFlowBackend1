import { asyncHandler } from '../utils/asyncHandler.js'
import { sendSuccess, sendCreated } from '../utils/apiResponse.js'
import { config } from '../config/environment.js'
import * as auth from '../services/auth.service.js'
import * as invitations from '../services/invitation.service.js'

const COOKIE = 'ef_refresh'
const cookieOpts = { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/api/v1/auth' }
const setRefresh = (res, token) => res.cookie(COOKIE, token, { ...cookieOpts, maxAge: config.REFRESH_TTL_DAYS * 86400000 })
const clearRefresh = (res) => res.clearCookie(COOKIE, cookieOpts)
const metaOf = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip })
// The refresh token travels only in the httpOnly cookie, never in the JSON body.
const respond = (res, { refreshToken, ...data }, message, created = false) => {
  if (refreshToken) setRefresh(res, refreshToken)
  return created ? sendCreated(res, data, message) : sendSuccess(res, { data, message })
}

export const register = asyncHandler(async (req, res) => respond(res, await auth.registerOrganization(req.body, metaOf(req)), 'Organization registered successfully', true))
export const login = asyncHandler(async (req, res) => respond(res, await auth.login(req.body, metaOf(req)), 'Logged in successfully'))
export const acceptInvitation = asyncHandler(async (req, res) => respond(res, await invitations.acceptInvitation(req.body, metaOf(req)), 'Invitation accepted'))

export const refresh = asyncHandler(async (req, res) => {
  try { return respond(res, await auth.refresh(req.cookies?.[COOKIE], metaOf(req)), 'Session refreshed') }
  catch (err) { clearRefresh(res); throw err }
})
export const logout = asyncHandler(async (req, res) => { await auth.logout(req.cookies?.[COOKIE]); clearRefresh(res); sendSuccess(res, { message: 'Logged out' }) })
export const logoutAll = asyncHandler(async (req, res) => { await auth.logoutAll(req.auth.userId); clearRefresh(res); sendSuccess(res, { message: 'Signed out of all devices' }) })
export const forgotPassword = asyncHandler(async (req, res) => {
  await auth.forgotPassword(req.body)
  sendSuccess(res, { message: 'If an account exists for that email, a reset link is on its way.' })
})
export const resetPassword = asyncHandler(async (req, res) => { await auth.resetPassword(req.body, metaOf(req)); clearRefresh(res); sendSuccess(res, { message: 'Password updated. Log in with your new password.' }) })
export const changePassword = asyncHandler(async (req, res) => { await auth.changePassword(req.auth, req.body, req.cookies?.[COOKIE], metaOf(req)); sendSuccess(res, { message: 'Password changed. Other devices have been signed out.' }) })
export const me = asyncHandler(async (req, res) => sendSuccess(res, { data: await auth.getMe(req.auth) }))
export const updateMe = asyncHandler(async (req, res) => sendSuccess(res, { data: await auth.updateProfile(req.auth.userId, req.body), message: 'Profile updated' }))
