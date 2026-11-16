import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import mongoSanitize from 'express-mongo-sanitize'
import path from 'node:path'
import swaggerUi from 'swagger-ui-express'
import { config } from './config/environment.js'
import { requestLogger } from './middlewares/requestLogger.js'
import { globalLimiter } from './middlewares/rateLimiter.js'
import { notFound, errorHandler } from './middlewares/errorHandler.js'
import { openApiSpec } from './docs/swagger.js'
import routes from './routes/index.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(requestLogger)
app.use(helmet())
app.use(cors({
  origin: (origin, cb) => (!origin || config.corsOrigins.includes(origin) ? cb(null, true) : cb(new Error(`CORS: origin ${origin} is not allowed`))),
  credentials: true,
}))
app.use(globalLimiter)
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(cookieParser())
app.use(mongoSanitize())

if (!config.isProd) {
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApiSpec))
}
// Only public assets (logos) are served statically. Private documents will use authorized downloads.
app.use('/uploads', (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next() },
  express.static(path.resolve(config.UPLOAD_DIR, 'public'), { index: false, dotfiles: 'deny', maxAge: '1h' }))
app.use('/api/v1', routes)

app.use(notFound)
app.use(errorHandler)
export default app
