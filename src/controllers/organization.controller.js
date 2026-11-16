import { asyncHandler } from '../utils/asyncHandler.js'
import { sendSuccess, sendCreated } from '../utils/apiResponse.js'
import * as invitations from '../services/invitation.service.js'

export const invite = asyncHandler(async (req, res) =>
  sendCreated(res, await invitations.createInvitation(req.auth, req.body, { ip: req.ip }), 'Invitation sent'))
export const members = asyncHandler(async (req, res) => {
  const { items, meta } = await invitations.listMembers(req.auth, req.query)
  sendSuccess(res, { data: items, meta, message: 'Members retrieved' })
})
