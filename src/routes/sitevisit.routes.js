import { Router } from 'express'
import { siteVisit as c } from '../controllers/crm.controllers.js'
import * as v from '../validators/crm.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization, authorize('visit:manage'))
r.get('/', validate(v.listVisitsSchema), c.list)
r.post('/', validate(v.createVisitSchema), c.create)
r.get('/calendar', validate(v.calendarSchema), c.calendar)
r.get('/summary', c.summary)
r.get('/:id', validate(idParam), c.get)
r.patch('/:id', validate({ ...idParam, ...v.updateVisitSchema }), c.update)
r.patch('/:id/reschedule', validate({ ...idParam, ...v.rescheduleSchema }), c.reschedule)
r.patch('/:id/cancel', validate({ ...idParam, ...v.cancelSchema }), c.cancel)
r.patch('/:id/complete', validate({ ...idParam, ...v.completeVisitSchema }), c.complete)
r.patch('/:id/no-show', validate(idParam), c.noShow)
r.patch('/:id/feedback', validate({ ...idParam, ...v.visitFeedbackSchema }), c.feedback)
export default r
