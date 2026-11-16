import { ApiError } from '../utils/ApiError.js'

// validate({ body, query, params }) with Zod schemas. Parsed values replace the originals.
export const validate = (schemas) => (req, _res, next) => {
  const errors = []
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue
    const result = schemas[part].safeParse(req[part])
    if (result.success) {
      if (part === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true })
      else req[part] = result.data
    } else {
      errors.push(...result.error.issues.map((i) => ({ field: [part, ...i.path].join('.'), message: i.message })))
    }
  }
  next(errors.length ? ApiError.badRequest('Validation failed', errors) : undefined)
}
