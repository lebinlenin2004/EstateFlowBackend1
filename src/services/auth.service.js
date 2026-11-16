import bcrypt from 'bcrypt'
import User from '../models/User.js'
import Organization from '../models/Organization.js'
import Membership from '../models/Membership.js'
import RefreshSession from '../models/RefreshSession.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import { ApiError } from '../utils/ApiError.js'
import { config } from '../config/environment.js'
import { ROLES } from '../constants/roles.js'
import { ROLE_PERMISSIONS } from '../constants/permissions.js'
import { sha256, randomToken } from '../utils/crypto.js'
import { signAccessToken } from '../utils/tokens.js'
import { sendMail } from '../utils/mailer.js'
import { audit } from './audit.service.js'

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10)
const idOf = (v) => String(v?._id ?? v)
export const hashPassword = (pw) => bcrypt.hash(pw, config.BCRYPT_ROUNDS)

const userView = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone ?? null, isPlatformAdmin: u.isPlatformAdmin })
const orgView = (o) => (o && o.name ? { id: idOf(o), name: o.name, plan: o.plan, logo: o.logo ?? null } : null)

function describe(user, membership) {
  const role = membership?.role ?? ROLES.SUPER_ADMIN
  return { user: userView(user), organization: orgView(membership?.organization), role, permissions: ROLE_PERMISSIONS[role] ?? [] }
}

export async function issueSession({ user, membership, family = randomToken(16), meta = {} }) {
  const role = membership?.role ?? ROLES.SUPER_ADMIN
  const orgId = membership ? idOf(membership.organization) : null
  const accessToken = signAccessToken({ sub: user.id, org: orgId, mid: membership ? membership.id : null, role })
  const refreshToken = randomToken(48)
  await RefreshSession.create({
    user: user._id, organization: orgId, membership: membership?._id ?? null, tokenHash: sha256(refreshToken), family,
    expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86400000), userAgent: meta.userAgent?.slice(0, 255), ip: meta.ip,
  })
  return { accessToken, refreshToken }
}

const revokeFamily = (family) => RefreshSession.updateMany({ family, revokedAt: null }, { revokedAt: new Date() })

export async function registerOrganization({ organizationName, name, email, phone, password }, meta) {
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists. Log in instead.')
  if (await Organization.exists({ email })) throw ApiError.conflict('An organization with this email already exists.')
  const created = {}
  try {
    created.org = await Organization.create({ name: organizationName, email, phone })
    created.user = await User.create({ name, email, phone, passwordHash: await hashPassword(password) })
    created.membership = await Membership.create({ user: created.user._id, organization: created.org._id, role: ROLES.OWNER })
  } catch (err) { // compensate: no half-created tenants
    await Promise.allSettled([created.membership?.deleteOne(), created.user?.deleteOne(), created.org?.deleteOne()])
    throw err
  }
  created.membership.organization = created.org
  const tokens = await issueSession({ user: created.user, membership: created.membership, meta })
  await audit({ organization: created.org._id, actor: created.user._id, action: 'organization.registered', entity: { type: 'Organization', id: created.org._id }, ip: meta.ip })
  return { ...describe(created.user, created.membership), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
}

export async function login({ email, password, organizationId }, meta) {
  const user = await User.findOne({ email }).select('+passwordHash')
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok || user.status !== 'active') throw ApiError.unauthorized('Invalid email or password')

  const memberships = await Membership.find({ user: user._id, status: 'active' }).populate('organization', 'name plan logo status').sort('createdAt')
  const usable = memberships.filter((m) => m.organization?.status === 'active')
  const membership = organizationId ? usable.find((m) => idOf(m.organization) === organizationId) : usable[0]
  if (organizationId && !membership) throw ApiError.forbidden('You do not belong to that organization')
  if (!membership && !user.isPlatformAdmin) throw ApiError.forbidden('Your account has no active organization. Contact your administrator.')

  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() })
  const tokens = await issueSession({ user, membership, meta })
  await audit({ organization: membership ? idOf(membership.organization) : null, actor: user._id, action: 'auth.login', ip: meta.ip })
  return {
    ...describe(user, membership), ...tokens,
    memberships: usable.map((m) => ({ organizationId: idOf(m.organization), name: m.organization.name, role: m.role })),
  }
}

export async function refresh(rawToken, meta) {
  if (!rawToken) throw ApiError.unauthorized('Session expired. Log in again.')
  const hash = sha256(rawToken)
  // Atomic: only one request can consume a given refresh token.
  const session = await RefreshSession.findOneAndUpdate({ tokenHash: hash, revokedAt: null, expiresAt: { $gt: new Date() } }, { revokedAt: new Date() })
  if (!session) {
    const reused = await RefreshSession.findOne({ tokenHash: hash })
    if (reused?.revokedAt) await revokeFamily(reused.family) // reuse of a rotated token: assume theft, kill the chain
    throw ApiError.unauthorized('Session expired. Log in again.')
  }
  const user = await User.findById(session.user)
  let membership = null
  let valid = user?.status === 'active'
  if (valid && session.membership) {
    membership = await Membership.findOne({ _id: session.membership, status: 'active' }).populate('organization', 'name plan logo status')
    valid = !!membership && membership.organization?.status === 'active'
  } else if (valid && !user.isPlatformAdmin) valid = false
  if (!valid) { await revokeFamily(session.family); throw ApiError.unauthorized('Session expired. Log in again.') }
  const tokens = await issueSession({ user, membership, family: session.family, meta })
  return { ...describe(user, membership), ...tokens }
}

export async function logout(rawToken) {
  if (!rawToken) return
  const session = await RefreshSession.findOne({ tokenHash: sha256(rawToken) })
  if (session) await revokeFamily(session.family)
}

export const logoutAll = (userId) => RefreshSession.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() })

export async function getMe(auth) {
  const user = await User.findById(auth.userId)
  const membership = auth.membershipId ? await Membership.findById(auth.membershipId).populate('organization', 'name plan logo status') : null
  return describe(user, membership)
}

export async function updateProfile(userId, patch) {
  const user = await User.findByIdAndUpdate(userId, patch, { new: true, runValidators: true })
  return userView(user)
}

export async function forgotPassword({ email }) {
  const user = await User.findOne({ email, status: 'active' })
  if (!user) return // identical response either way: no account enumeration
  await PasswordResetToken.deleteMany({ user: user._id, usedAt: null })
  const token = randomToken(32)
  await PasswordResetToken.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
  await sendMail({ to: user.email, subject: 'Reset your EstateFlow password',
    text: `Hi ${user.name},\n\nUse this link to set a new password (valid for 1 hour):\n${config.FRONTEND_URL}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.` })
}

export async function resetPassword({ token, password }, meta) {
  const record = await PasswordResetToken.findOneAndUpdate({ tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() })
  if (!record) throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.')
  await User.updateOne({ _id: record.user }, { passwordHash: await hashPassword(password), passwordChangedAt: new Date() })
  await logoutAll(record.user)
  await audit({ actor: record.user, action: 'auth.password_reset', ip: meta.ip })
}

export async function changePassword(auth, { currentPassword, newPassword }, currentRefreshToken, meta) {
  const user = await User.findById(auth.userId).select('+passwordHash')
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw ApiError.badRequest('Current password is incorrect')
  if (currentPassword === newPassword) throw ApiError.badRequest('Choose a password different from the current one')
  user.passwordHash = await hashPassword(newPassword)
  user.passwordChangedAt = new Date()
  await user.save()
  const current = currentRefreshToken ? await RefreshSession.findOne({ tokenHash: sha256(currentRefreshToken), user: user._id }) : null
  // Sign out every other device; keep this one (its next refresh returns a fresh access token).
  await RefreshSession.updateMany({ user: user._id, revokedAt: null, ...(current ? { family: { $ne: current.family } } : {}) }, { revokedAt: new Date() })
  await audit({ organization: auth.orgId, actor: user._id, action: 'auth.password_changed', ip: meta.ip })
}
