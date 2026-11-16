import multer from 'multer'
// Memory storage: the file is verified (magic bytes) before anything touches disk.
export const imageUpload = (field) => multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single(field)
export const imagesUpload = (field, max = 5) => multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: max } }).array(field, max)
