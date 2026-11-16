import mongoose from 'mongoose'

export async function getHealth() {
  let database = 'down'
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping()
      database = 'up'
    }
  } catch { /* reported as down */ }
  return { status: database === 'up' ? 'ok' : 'degraded', database, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() }
}
