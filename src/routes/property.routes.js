import { Router } from 'express'
import { property as c } from '../controllers/core.controllers.js'
import * as v from '../validators/property.validators.js'
import { idParam } from '../validators/common.js'
import { validate } from '../middlewares/validate.js'
import { imagesUpload } from '../middlewares/upload.js'
import { authenticate, authorize, requireOrganization } from '../middlewares/auth.js'

const r = Router()
r.use(authenticate, requireOrganization)
r.get('/', authorize('property:read'), validate(v.listPropertiesSchema), c.list)
r.post('/', authorize('property:write'), validate(v.createPropertySchema), c.create)
r.get('/summary', authorize('property:read'), c.summary)
r.get('/:id', authorize('property:read'), validate(idParam), c.get)
r.patch('/:id', authorize('property:write'), validate({ ...idParam, ...v.updatePropertySchema }), c.update)
r.delete('/:id', authorize('property:delete'), validate(idParam), c.archive)
r.post('/:id/restore', authorize('property:delete'), validate(idParam), c.restore)
r.patch('/:id/status', authorize('property:write'), validate({ ...idParam, ...v.statusSchema }), c.status)
r.patch('/:id/assign', authorize('property:write'), validate({ ...idParam, ...v.assignSchema }), c.assign)
r.get('/:id/interest', authorize('property:read'), validate(idParam), c.interest)
r.get('/:id/history', authorize('property:read'), validate({ ...idParam, ...v.historySchema }), c.history)
r.post('/:id/images', authorize('property:write'), validate(idParam), imagesUpload('images', 5), c.addImages)
r.delete('/:id/images/:imageId', authorize('property:write'), validate(v.imageParams), c.removeImage)
r.patch('/:id/images/:imageId/cover', authorize('property:write'), validate(v.imageParams), c.cover)
export default r
