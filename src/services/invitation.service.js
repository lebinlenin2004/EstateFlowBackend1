import Invitation from '../models/Invitation.js'
import Membership from '../models/Membership.js'
import Organization from '../models/Organization.js'
import User from '../models/User.js'
import bcrypt from 'bcrypt'
import { ApiError } from '../utils/ApiError.js'
import { config } from '../config/environment.js'
import { INVITABLE_ROLES } from '../constants/roles.js'
import { sha256, randomToken } from '../utils/crypto.js'
import { sendMail } from '../utils/mailer.js'
import Branch from '../models/Branch.js'
import { ROLES } from '../constants/roles.js'
import { audit } from './audit.service.js'
import { hashPassword, issueSession } from './auth.service.js'

export async function createInvitation(auth, { email, role, branchId }, meta) {
  if (!INVITABLE_ROLES[auth.role]?.includes(role)) throw ApiError.forbidden(`Your role cannot invite a ${role.replace('_', ' ')}`)
  const existingUser = await User.findOne({ email })
  if (existingUser && (await Membership.exists({ user: existingUser._id, organization: auth.orgId, status: 'active' })))
    throw ApiError.conflict('This person is already a member of your organization')
  // Branch managers can only invite into their own branch; everyone else may pick any active branch of this organization.
  let branch = null
  if (auth.role === ROLES.BRANCH_MANAGER) {
    if (!auth.branchId) throw ApiError.forbidden('You are not assigned to a branch')
    if (branchId && branchId !== auth.branchId) throw ApiError.forbidden('You can only invite people into your own branch')
    branch = auth.branchId
  } else if (branchId) {
    if (!(await Branch.exists({ _id: branchId, status: 'active' }))) throw ApiError.badRequest('That branch does not exist or is inactive')
    branch = branchId
  }
  await Invitation.updateMany({ organization: auth.orgId, email, status: 'pending' }, { status: 'revoked' })
  const token = randomToken(32)
  const org = await Organization.findById(auth.orgId).select('name')
  const invitation = await Invitation.create({ organization: auth.orgId, email, role, branch, tokenHash: sha256(token), invitedBy: auth.userId,
    expiresAt: new Date(Date.now() + 7 * 86400000) })
  await sendMail({ to: email, subject: `You're invited to ${org.name} on EstateFlow`,
    text: `You have been invited to join ${org.name} as ${role.replace('_', ' ')}.\nAccept here (valid 7 days): ${config.FRONTEND_URL}/accept-invitation?token=${token}` })
  await audit({ organization: auth.orgId, actor: auth.userId, action: 'member.invited', entity: { type: 'Invitation', id: invitation._id }, metadata: { email, role }, ip: meta.ip })
  return { id: invitation.id, email, role, status: invitation.status, expiresAt: invitation.expiresAt }
}

export async function acceptInvitation({ token, name, password }, meta) {
  const invitation = await Invitation.findOneAndUpdate({ tokenHash: sha256(token), status: 'pending', expiresAt: { $gt: new Date() } },
    { status: 'accepted', acceptedAt: new Date() })
  if (!invitation) throw ApiError.badRequest('This invitation is invalid or has expired. Ask for a new one.')
  let user = await User.findOne({ email: invitation.email }).select('+passwordHash')
  try {
    if (user) { // existing account: must prove ownership, so an invite link alone can't take over an account
      if (!(await bcrypt.compare(password, user.passwordHash))) throw ApiError.unauthorized('Incorrect password for the existing account')
    } else {
      if (!name) throw ApiError.badRequest('Enter your name to create your account')
      user = await User.create({ name, email: invitation.email, passwordHash: await hashPassword(password) })
    }
    var membership = await Membership.findOneAndUpdate({ user: user._id, organization: invitation.organization },
      { role: invitation.role, branch: invitation.branch, status: 'active', invitedBy: invitation.invitedBy }, { upsert: true, new: true, setDefaultsOnInsert: true })
  } catch (err) {
    await Invitation.updateOne({ _id: invitation._id }, { status: 'pending', acceptedAt: null }) // let them retry
    throw err
  }
  await membership.populate('organization', 'name plan logo status')
  const tokens = await issueSession({ user, membership, meta })
  await audit({ organization: invitation.organization, actor: user._id, action: 'member.joined', entity: { type: 'Membership', id: membership._id }, ip: meta.ip })
  return { user: { id: user.id, name: user.name, email: user.email }, role: membership.role, organization: { id: String(membership.organization._id), name: membership.organization.name }, ...tokens }
}

export async function listMembers(auth, { page, limit }) {
  const filter = { organization: auth.orgId, status: { $ne: 'removed' } }
  const [items, total] = await Promise.all([
    Membership.find(filter).populate('user', 'name email phone status').sort('createdAt').skip((page - 1) * limit).limit(limit),
    Membership.countDocuments(filter),
  ])
  return { items: items.map((m) => ({ id: m.id, role: m.role, status: m.status, branch: m.branch, user: m.user })), meta: { page, limit, total } }
}
