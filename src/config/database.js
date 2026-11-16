import mongoose from 'mongoose'
import { config } from './environment.js'
import { logger } from '../utils/logger.js'

mongoose.set('strictQuery', true)

export async function connectDatabase(uri = config.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
  logger.info('MongoDB connected')
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  return mongoose.connection
}

export const disconnectDatabase = () => mongoose.disconnect()
