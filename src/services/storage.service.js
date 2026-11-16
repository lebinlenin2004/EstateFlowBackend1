import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config/environment.js'

// Public files (logos, property images). Driver chosen by STORAGE_DRIVER: local disk (served at /uploads) or S3.
// Private documents (agreements) will get a separate signed-URL flow in Phase 5.
const s3Base = () => (config.S3_PUBLIC_BASE_URL ?? `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`).replace(/\/$/, '')

let s3Client
async function s3() {
  if (!s3Client) {
    const { S3Client } = await import('@aws-sdk/client-s3') // loaded only when S3 is enabled
    s3Client = new S3Client({ region: config.S3_REGION,
      ...(config.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } } : {}) })
  }
  return s3Client
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

export async function savePublicFile({ orgId, folder, buffer, ext }) {
  const key = path.posix.join(String(orgId), folder, `${randomUUID()}.${ext}`)
  if (config.STORAGE_DRIVER === 's3') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await (await s3()).send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: buffer, ContentType: MIME[ext], CacheControl: 'public, max-age=31536000, immutable' }))
    return { key, url: `${s3Base()}/${key}` }
  }
  const abs = path.resolve(config.UPLOAD_DIR, 'public', key)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, buffer)
  return { key, url: `/uploads/${key}` }
}

export async function deletePublicFile(url) {
  if (!url) return
  try {
    if (url.startsWith('/uploads/')) {
      const root = path.resolve(config.UPLOAD_DIR, 'public')
      const abs = path.resolve(root, url.slice('/uploads/'.length))
      if (abs.startsWith(root)) await fs.rm(abs, { force: true }) // traversal guard
    } else if (config.STORAGE_DRIVER === 's3' && url.startsWith(`${s3Base()}/`)) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
      await (await s3()).send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: url.slice(s3Base().length + 1) }))
    }
  } catch { /* best effort: an orphaned file is better than a failed request */ }
}
