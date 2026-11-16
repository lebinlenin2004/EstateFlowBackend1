import { Router } from 'express'
import { customer as c } from '../controllers/core.controllers.js'
import * as v from '../validators/customer.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/', authorize('customer:read'), validate(v.listCustomersSchema), c.list)
r.post('/', authorize('customer:write'), validate(v.createCustomerSchema), c.create)
r.get('/:id', authorize('customer:read'), validate(idParam), c.get)
r.get('/:id/history', authorize('customer:read'), validate(idParam), c.history)
r.patch('/:id', authorize('customer:write'), validate({ ...idParam, ...v.updateCustomerSchema }), c.update)
r.delete('/:id', authorize('customer:write'), validate(idParam), c.archive)
r.post('/:id/restore', authorize('customer:write'), validate(idParam), c.restore)
export default r
