import { Router } from 'express'
import * as c from '../controllers/organization.controller.js'
import { organization as o } from '../controllers/phase3.controllers.js'
import * as v from '../validators/auth.validators.js'
import * as ov from '../validators/organization.validators.js'
import { validate } from '../middlewares/validate.js'
import { imageUpload } from '../middlewares/upload.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/me', authorize('org:read'), o.get)
r.patch('/me', authorize('org:update'), validate(ov.updateOrganizationSchema), o.update)
r.post('/me/logo', authorize('org:update'), imageUpload('logo'), o.logo)
r.get('/me/settings', authorize('org:read'), o.getSettings)
r.patch('/me/settings', authorize('org:update'), validate(ov.updateSettingsSchema), o.updateSettings)
r.get('/members', authorize('member:read'), validate(v.listMembersSchema), c.members)
r.post('/invitations', authorize('member:invite'), validate(v.inviteSchema), c.invite)
export default r
