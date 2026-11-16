import { Router } from 'express'
import { branch as c } from '../controllers/phase3.controllers.js'
import * as v from '../validators/branch.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/', authorize('branch:read'), validate(v.listBranchesSchema), c.list)
r.post('/', authorize('branch:manage'), validate(v.createBranchSchema), c.create)
r.get('/:id', authorize('branch:read'), validate(idParam), c.get)
r.patch('/:id', authorize('branch:manage'), validate({ ...idParam, ...v.updateBranchSchema }), c.update)
r.delete('/:id', authorize('branch:manage'), validate(idParam), c.archive)
export default r
