import pino from 'pino'
import { config } from '../config/environment.js'

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.passwordHash', '*.token'],
  ...(config.isProd || config.isTest ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
})
