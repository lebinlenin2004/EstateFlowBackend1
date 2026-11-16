import { Router } from 'express'
import { lead as c } from '../controllers/crm.controllers.js'
import * as v from '../validators/crm.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/', authorize('lead:read'), validate(v.listLeadsSchema), c.list)
r.post('/', authorize('lead:write'), validate(v.createLeadSchema), c.create)
r.get('/pipeline', authorize('lead:read'), validate(v.pipelineSchema), c.pipeline)
r.get('/stats', authorize('lead:read'), validate(v.leadStatsSchema), c.stats)
r.get('/:id', authorize('lead:read'), validate(idParam), c.get)
r.patch('/:id', authorize('lead:write'), validate({ ...idParam, ...v.updateLeadSchema }), c.update)
r.patch('/:id/status', authorize('lead:write'), validate({ ...idParam, ...v.leadStatusSchema }), c.status)
r.patch('/:id/priority', authorize('lead:write'), validate({ ...idParam, ...v.leadPrioritySchema }), c.priority)
r.patch('/:id/assign', authorize('lead:assign'), validate({ ...idParam, ...v.leadAssignSchema }), c.assign)
r.post('/:id/convert', authorize('lead:write'), validate({ ...idParam, ...v.convertSchema }), c.convert)
r.delete('/:id', authorize('lead:assign'), validate(idParam), c.archive)
r.post('/:id/restore', authorize('lead:assign'), validate(idParam), c.restore)
r.get('/:id/activities', authorize('lead:read'), validate({ ...idParam, ...v.activitiesSchema }), c.activities)
r.post('/:id/activities', authorize('lead:write'), validate({ ...idParam, ...v.activitySchema }), c.addActivity)
export default r
