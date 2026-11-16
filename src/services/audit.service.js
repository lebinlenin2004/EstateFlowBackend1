import AuditLog from '../models/AuditLog.js'
import { logger } from '../utils/logger.js'
// Never lets an audit failure break the user's request.
export async function audit(entry) {
  try { await AuditLog.create(entry) } catch (err) { logger.error({ err, action: entry.action }, 'Audit log write failed') }
}
