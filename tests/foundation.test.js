import request from 'supertest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import app from '../src/app.js'
import { validate } from '../src/middlewares/validate.js'
import { z } from 'zod'

let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })

describe('health', () => {
  it('reports ok with database up', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'up' } })
  })
  it('sets a request id header', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-request-id']).toBeTruthy()
  })
})

describe('error handling', () => {
  it('returns the standard shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ success: false, errors: [] })
    expect(res.body.message).toMatch(/Route not found/)
  })
  it('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send('{bad')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
  it('blocks origins outside the CORS allowlist', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://evil.example')
    expect(res.status).toBe(403)
  })
})

describe('validate middleware', () => {
  it('returns field-level errors', () => {
    const next = jest.fn()
    validate({ body: z.object({ email: z.string().email() }) })({ body: { email: 'x' } }, {}, next)
    const err = next.mock.calls[0][0]
    expect(err.statusCode).toBe(400)
    expect(err.errors[0].field).toBe('body.email')
  })
})
