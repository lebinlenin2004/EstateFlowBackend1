import { Router } from 'express'
import { owner as c } from '../controllers/core.controllers.js'
import * as v from '../validators/property.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization, authorize('owner:manage'))
r.get('/', validate(v.listOwnersSchema), c.list)
r.post('/', validate(v.createOwnerSchema), c.create)
r.get('/:id', validate(idParam), c.get)
r.patch('/:id', validate({ ...idParam, ...v.updateOwnerSchema }), c.update)
r.delete('/:id', validate(idParam), c.archive)
export default r
