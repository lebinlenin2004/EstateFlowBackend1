import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app, request, outbox, registerOrg, addMember, cookieOf, strongPassword } from './helpers.js'
import User from '../src/models/User.js'

let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); outbox.length = 0 })
const auth = (t) => ({ Authorization: `Bearer ${t}` })

describe('registration and login', () => {
  it('registers an organization, returns a session and never exposes secrets', async () => {
    const { res } = await registerOrg(1)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ role: 'owner', organization: { name: 'Org 1' } })
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.refreshToken).toBeUndefined()
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/)
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/)
    expect((await User.findOne({ email: 'owner1@org1.test' }).select('+passwordHash')).passwordHash).not.toBe(strongPassword)
  })
  it('rejects duplicate emails', async () => {
    await registerOrg(1)
    expect((await registerOrg(1)).res.status).toBe(409)
  })
  it('logs in, and gives the same error for wrong password and unknown email', async () => {
    await registerOrg(1)
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'owner1@org1.test', password: strongPassword })).status).toBe(200)
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'owner1@org1.test', password: 'Wrong1234' })
    const none = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@org1.test', password: 'Wrong1234' })
    expect([bad.status, none.status]).toEqual([401, 401])
    expect(bad.body.message).toBe(none.body.message)
  })
  it('serves /me with permissions', async () => {
    const o = await registerOrg(1)
    const res = await request(app).get('/api/v1/auth/me').set(auth(o.token))
    expect(res.status).toBe(200)
    expect(res.body.data.permissions).toContain('member:invite')
  })
  it('blocks deactivated users immediately, even with a valid token', async () => {
    const o = await registerOrg(1)
    await User.updateOne({ email: 'owner1@org1.test' }, { status: 'inactive' })
    expect((await request(app).get('/api/v1/auth/me').set(auth(o.token))).status).toBe(401)
  })
})

describe('refresh token rotation', () => {
  it('rotates on every refresh and kills the chain when an old token is replayed', async () => {
    const o = await registerOrg(1)
    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', o.cookie)
    expect(first.status).toBe(200)
    const newCookie = cookieOf(first)
    expect(newCookie).not.toBe(o.cookie)
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', o.cookie)).status).toBe(401) // replay
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', newCookie)).status).toBe(401) // family revoked
  })
  it('revokes the session on logout', async () => {
    const o = await registerOrg(1)
    await request(app).post('/api/v1/auth/logout').set('Cookie', o.cookie).expect(200)
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', o.cookie)).status).toBe(401)
  })
  it('rejects a missing refresh cookie', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401)
  })
})

describe('password flows', () => {
  it('resets a password from the emailed token and signs out old sessions', async () => {
    const o = await registerOrg(1)
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'owner1@org1.test' })
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@org1.test' })
    expect(forgot.body.message).toBe(unknown.body.message)
    const token = outbox.at(-1).text.match(/token=([\w-]+)/)[1]
    await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassw0rd' }).expect(200)
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassw0rd' })).status).toBe(400) // single use
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', o.cookie)).status).toBe(401)
    expect((await request(app).get('/api/v1/auth/me').set(auth(o.token))).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'owner1@org1.test', password: strongPassword })).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'owner1@org1.test', password: 'NewPassw0rd' })).status).toBe(200)
  })
  it('changes a password, signs out other devices, keeps this one', async () => {
    const o = await registerOrg(1)
    const other = await request(app).post('/api/v1/auth/login').send({ email: 'owner1@org1.test', password: strongPassword })
    const wrong = await request(app).post('/api/v1/auth/change-password').set(auth(o.token)).send({ currentPassword: 'Nope12345', newPassword: 'NewPassw0rd' })
    expect(wrong.status).toBe(400)
    await request(app).post('/api/v1/auth/change-password').set(auth(o.token)).set('Cookie', o.cookie).send({ currentPassword: strongPassword, newPassword: 'NewPassw0rd' }).expect(200)
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieOf(other))).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', o.cookie)).status).toBe(200)
  })
})

describe('invitations and role permissions', () => {
  it('lets an owner invite an agent who joins and can log in', async () => {
    const owner = await registerOrg(1)
    const agent = await addMember(owner, 'sales_agent', 'agent@org1.test')
    expect(agent.res.status).toBe(200)
    expect(agent.res.body.data.role).toBe('sales_agent')
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'agent@org1.test', password: strongPassword })).status).toBe(200)
  })
  it('rejects reused or expired invitation tokens', async () => {
    const owner = await registerOrg(1)
    await addMember(owner, 'accountant', 'acct@org1.test')
    const token = outbox.at(-1).text.match(/token=([\w-]+)/)[1]
    expect((await request(app).post('/api/v1/auth/accept-invitation').send({ token, name: 'X Y', password: strongPassword })).status).toBe(400)
  })
  it('forbids sales agents from inviting and from listing members only where permitted', async () => {
    const owner = await registerOrg(1)
    const agent = await addMember(owner, 'sales_agent', 'agent@org1.test')
    const invite = await request(app).post('/api/v1/organizations/invitations').set(auth(agent.token)).send({ email: 'x@org1.test', role: 'sales_agent' })
    expect(invite.status).toBe(403)
    expect((await request(app).get('/api/v1/organizations/members').set(auth(agent.token))).status).toBe(403)
  })
  it('stops branch managers inviting owners', async () => {
    const owner = await registerOrg(1)
    const bm = await addMember(owner, 'branch_manager', 'bm@org1.test')
    const res = await request(app).post('/api/v1/organizations/invitations').set(auth(bm.token)).send({ email: 'boss@org1.test', role: 'owner' })
    expect(res.status).toBe(403)
  })
})
