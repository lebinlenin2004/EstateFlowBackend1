process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = 'mongodb://localhost:27017/estateflow-test'
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-0123456789'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-0123456789'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.BCRYPT_ROUNDS = '4'

import os from 'node:os'
import path from 'node:path'
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'estateflow-test-uploads')
