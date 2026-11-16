import { ZodError } from 'zod'
import mongoose from 'mongoose'
import { ApiError } from '../utils/ApiError.js'
import { config } from '../config/environment.js'
import { logger } from '../utils/logger.js'

export const notFound = (req, _res, next) => next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`))

function normalize(err) {
  if (err instanceof ApiError) return err
  if (err instanceof ZodError) return ApiError.badRequest('Validation failed', err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
  if (err instanceof mongoose.Error.ValidationError)
    return ApiError.badRequest('Validation failed', Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })))
  if (err instanceof mongoose.Error.CastError) return ApiError.badRequest(`Invalid ${err.path}`)
  if (err?.code === 11000) return ApiError.conflict(`Duplicate value for ${Object.keys(err.keyPattern || {}).join(', ') || 'field'}`)
  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') return ApiError.unauthorized('Invalid or expired token')
  if (err?.type === 'entity.parse.failed') return ApiError.badRequest('Request body is not valid JSON')
  if (err?.type === 'entity.too.large') return new ApiError(413, 'Request body is too large')
  if (err?.name === 'MulterError') return err.code === 'LIMIT_FILE_SIZE' ? new ApiError(413, 'File is too large (max 2 MB)') : ApiError.badRequest(err.message)
  if (err?.message?.startsWith('CORS')) return ApiError.forbidden(err.message)
  return null
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err)
  if (!known) req.log?.error({ err }, 'Unhandled error') || logger.error({ err }, 'Unhandled error')
  const status = known?.statusCode || 500
  const body = {
    success: false,
    message: known ? known.message : 'Something went wrong on our side. Try again shortly.',
    errors: known?.errors || [],
  }
  if (!config.isProd && !known) body.stack = err.stack
  res.status(status).json(body)
}
