import { request, app } from './helpers.js'
// The browser app (another origin) must be able to send the refresh cookie and the Authorization header.
describe('CORS for the browser app', () => {
  it('answers the preflight for an allowed origin with credentials and the auth header', async () => {
    const res = await request(app).options('/api/v1/auth/refresh').set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization')
  })
  it('sets the refresh cookie attributes the browser app relies on', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'http://localhost:5173')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['set-cookie'].join(';')).toMatch(/ef_refresh=;.*Path=\/api\/v1\/auth/)
  })
})
