import { createHash, randomBytes } from 'node:crypto'
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
