import { asyncHandler } from '../utils/asyncHandler.js'
import { getHealth } from '../services/health.service.js'

export const health = asyncHandler(async (_req, res) => {
  const data = await getHealth()
  const ok = data.status === 'ok'
  res.status(ok ? 200 : 503).json({ success: ok, message: ok ? 'Service healthy' : 'Service degraded', data })
})
