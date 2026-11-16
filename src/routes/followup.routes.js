import { Router } from 'express'
import { followUp as c } from '../controllers/crm.controllers.js'
import * as v from '../validators/crm.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization, authorize('followup:manage'))
r.get('/', validate(v.listFollowUpsSchema), c.list)
r.post('/', validate(v.createFollowUpSchema), c.create)
r.get('/summary', validate(v.followUpSummarySchema), c.summary)
r.get('/:id', validate(idParam), c.get)
r.patch('/:id', validate({ ...idParam, ...v.updateFollowUpSchema }), c.update)
r.patch('/:id/complete', validate({ ...idParam, ...v.completeFollowUpSchema }), c.complete)
r.patch('/:id/cancel', validate({ ...idParam, ...v.cancelSchema }), c.cancel)
export default r
