// Storage driver selection. Phase 1 only reads the setting; the local and S3
// adapters (upload, delete, signed URL) are implemented with the Property module.
import { config } from './environment.js'
export const storageDriver = config.STORAGE_DRIVER
