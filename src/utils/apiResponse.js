export function sendSuccess(res, { data = null, message = 'Success', status = 200, meta } = {}) {
  const body = { success: true, message, data }
  if (meta) body.meta = meta
  return res.status(status).json(body)
}
export const sendCreated = (res, data, message = 'Created successfully') => sendSuccess(res, { data, message, status: 201 })
