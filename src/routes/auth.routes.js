import { Router } from 'express'
import * as c from '../controllers/auth.controller.js'
import * as v from '../validators/auth.validators.js'
import { validate } from '../middlewares/validate.js'
import { authenticate } from '../middlewares/auth.js'
import { authLimiter } from '../middlewares/rateLimiter.js'

const r = Router()
r.post('/register', authLimiter, validate(v.registerSchema), c.register)
r.post('/login', authLimiter, validate(v.loginSchema), c.login)
r.post('/refresh', authLimiter, c.refresh)
r.post('/logout', c.logout)
r.post('/logout-all', authenticate, c.logoutAll)
r.post('/forgot-password', authLimiter, validate(v.forgotPasswordSchema), c.forgotPassword)
r.post('/reset-password', authLimiter, validate(v.resetPasswordSchema), c.resetPassword)
r.post('/change-password', authenticate, validate(v.changePasswordSchema), c.changePassword)
r.post('/accept-invitation', authLimiter, validate(v.acceptInvitationSchema), c.acceptInvitation)
r.get('/me', authenticate, c.me)
r.patch('/me', authenticate, validate(v.updateProfileSchema), c.updateMe)
export default r
