import rateLimit from 'express-rate-limit'
import { config } from '../config/environment.js'

const make = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, skip: () => config.isTest,
    handler: (_req, res) => res.status(429).json({ success: false, message, errors: [] }) })

export const globalLimiter = make(15 * 60 * 1000, 300, 'Too many requests. Try again in a few minutes.')
// Applied to login, register and password routes in Phase 2.
export const authLimiter = make(15 * 60 * 1000, 20, 'Too many attempts. Try again in 15 minutes.')
