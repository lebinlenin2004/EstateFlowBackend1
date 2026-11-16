import { Router } from 'express'
import { employee as c } from '../controllers/phase3.controllers.js'
import * as v from '../validators/employee.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/', authorize('member:read'), validate(v.listEmployeesSchema), c.list)
r.get('/summary', authorize('member:read'), c.summary)
r.get('/invitations', authorize('member:read'), c.invitations)
r.delete('/invitations/:id', authorize('member:invite'), validate(idParam), c.revokeInvitation)
r.get('/:id', authorize('member:read'), validate(idParam), c.get)
r.patch('/:id', authorize('member:manage'), validate({ ...idParam, ...v.updateEmployeeSchema }), c.update)
r.patch('/:id/status', authorize('member:manage'), validate({ ...idParam, ...v.employeeStatusSchema }), c.status)
r.delete('/:id', authorize('member:manage'), validate(idParam), c.remove)
export default r
