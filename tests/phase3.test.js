import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app, request, outbox, registerOrg, addMember } from './helpers.js'

let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); outbox.length = 0 })
const as = (t) => ({ Authorization: `Bearer ${t}` })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const mkBranch = (t, body = {}) => request(app).post('/api/v1/branches').set(as(t)).send({ name: 'Calicut Main', ...body })

describe('organization profile and settings', () => {
  it('returns the organization with usage and updates it with merged address', async () => {
    const o = await registerOrg(1)
    const get = await request(app).get('/api/v1/organizations/me').set(as(o.token))
    expect(get.body.data).toMatchObject({ name: 'Org 1', plan: 'starter', usage: { employees: 1, branches: 0 } })
    await request(app).patch('/api/v1/organizations/me').set(as(o.token)).send({ address: { city: 'Kozhikode' } }).expect(200)
    const res = await request(app).patch('/api/v1/organizations/me').set(as(o.token)).send({ phone: '9000000000', address: { state: 'Kerala' } })
    expect(res.body.data.address).toMatchObject({ city: 'Kozhikode', state: 'Kerala' })
  })
  it('merges settings and keeps untouched defaults', async () => {
    const o = await registerOrg(1)
    const res = await request(app).patch('/api/v1/organizations/me/settings').set(as(o.token)).send({ notifications: { email: false }, leadAutoAssign: true })
    expect(res.body.data).toMatchObject({ currency: 'INR', leadAutoAssign: true, notifications: { email: false, inApp: true } })
  })
  it('lets only roles with org:update change things', async () => {
    const o = await registerOrg(1)
    const agent = await addMember(o, 'sales_agent', 'agent@org1.test')
    expect((await request(app).get('/api/v1/organizations/me').set(as(agent.token))).status).toBe(200)
    expect((await request(app).patch('/api/v1/organizations/me').set(as(agent.token)).send({ name: 'Hacked' })).status).toBe(403)
  })
  it('uploads a real image as logo and rejects disguised files', async () => {
    const o = await registerOrg(1)
    const ok = await request(app).post('/api/v1/organizations/me/logo').set(as(o.token)).attach('logo', PNG, 'logo.png')
    expect(ok.status).toBe(200)
    expect(ok.body.data.logo).toMatch(/^\/uploads\/.+\.png$/)
    expect((await request(app).get(ok.body.data.logo)).status).toBe(200)
    const fake = await request(app).post('/api/v1/organizations/me/logo').set(as(o.token)).attach('logo', Buffer.from('<script>alert(1)</script> padding padding'), 'logo.png')
    expect(fake.status).toBe(400)
  })
})

describe('branches', () => {
  it('creates, auto-codes, lists with employee counts and blocks duplicate codes', async () => {
    const o = await registerOrg(1)
    const a = await mkBranch(o.token)
    expect(a.status).toBe(201)
    expect(a.body.data.code).toBe('BR-001')
    expect((await mkBranch(o.token, { name: 'Second' })).body.data.code).toBe('BR-002')
    expect((await mkBranch(o.token, { name: 'Dup', code: 'br-001' })).status).toBe(409)
    const list = await request(app).get('/api/v1/branches').set(as(o.token))
    expect(list.body.meta.total).toBe(2)
  })
  it('restricts management to roles with branch:manage', async () => {
    const o = await registerOrg(1)
    const bm = await addMember(o, 'branch_manager', 'bm@org1.test')
    expect((await mkBranch(bm.token)).status).toBe(403)
  })
  it('refuses to archive a branch that still has active employees', async () => {
    const o = await registerOrg(1)
    const b = (await mkBranch(o.token)).body.data
    outbox.length = 0
    await request(app).post('/api/v1/organizations/invitations').set(as(o.token)).send({ email: 'a@org1.test', role: 'sales_agent', branchId: b.id }).expect(201)
    const token = outbox.at(-1).text.match(/token=([\w-]+)/)[1]
    await request(app).post('/api/v1/auth/accept-invitation').send({ token, name: 'Agent A', password: 'Str0ngPass!' }).expect(200)
    expect((await request(app).delete(`/api/v1/branches/${b.id}`).set(as(o.token))).status).toBe(409)
    expect((await request(app).get(`/api/v1/branches/${b.id}`).set(as(o.token))).body.data.employeeCount).toBe(1)
  })
  it('never exposes another organization branch, even by id', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    const b = (await mkBranch(o1.token)).body.data
    expect((await request(app).get(`/api/v1/branches/${b.id}`).set(as(o2.token))).status).toBe(404)
    expect((await request(app).patch(`/api/v1/branches/${b.id}`).set(as(o2.token)).send({ name: 'Mine now' })).status).toBe(404)
    expect((await request(app).delete(`/api/v1/branches/${b.id}`).set(as(o2.token))).status).toBe(404)
    expect((await request(app).get('/api/v1/branches').set(as(o2.token))).body.meta.total).toBe(0)
    expect((await request(app).post('/api/v1/organizations/invitations').set(as(o2.token)).send({ email: 'x@o2.test', role: 'sales_agent', branchId: b.id })).status).toBe(400)
  })
})

describe('employees', () => {
  async function setup() {
    const owner = await registerOrg(1)
    const agent = await addMember(owner, 'sales_agent', 'agent@org1.test')
    const list = await request(app).get('/api/v1/employees').set(as(owner.token))
    const agentRow = list.body.data.find((e) => e.user.email === 'agent@org1.test')
    const ownerRow = list.body.data.find((e) => e.role === 'owner')
    return { owner, agent, agentRow, ownerRow }
  }
  it('lists with search, filters and a summary', async () => {
    const { owner } = await setup()
    expect((await request(app).get('/api/v1/employees?search=agent').set(as(owner.token))).body.meta.total).toBe(1)
    expect((await request(app).get('/api/v1/employees?role=owner').set(as(owner.token))).body.meta.total).toBe(1)
    expect((await request(app).get('/api/v1/employees/summary').set(as(owner.token))).body.data).toMatchObject({ total: 2, active: 2, byRole: { owner: 1, sales_agent: 1 } })
  })
  it('changes roles and cuts access immediately on deactivation', async () => {
    const { owner, agent, agentRow } = await setup()
    const up = await request(app).patch(`/api/v1/employees/${agentRow.id}`).set(as(owner.token)).send({ role: 'accountant' })
    expect(up.body.data.role).toBe('accountant')
    await request(app).patch(`/api/v1/employees/${agentRow.id}/status`).set(as(owner.token)).send({ status: 'inactive' }).expect(200)
    expect((await request(app).get('/api/v1/auth/me').set(as(agent.token))).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', agent.cookie)).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'agent@org1.test', password: 'Str0ngPass!' })).status).toBe(403)
  })
  it('blocks self-changes and keeps one owner', async () => {
    const { owner, ownerRow } = await setup()
    expect((await request(app).patch(`/api/v1/employees/${ownerRow.id}`).set(as(owner.token)).send({ role: 'sales_agent' })).status).toBe(403)
    expect((await request(app).patch(`/api/v1/employees/${ownerRow.id}/status`).set(as(owner.token)).send({ status: 'inactive' })).status).toBe(403)
    expect((await request(app).delete(`/api/v1/employees/${ownerRow.id}`).set(as(owner.token))).status).toBe(403)
  })
  it('stops agents from managing anyone and branch managers from touching owners', async () => {
    const { owner, agent, ownerRow } = await setup()
    expect((await request(app).get('/api/v1/employees').set(as(agent.token))).status).toBe(403)
    const b = (await mkBranch(owner.token)).body.data
    const bm = await addMember(owner, 'branch_manager', 'bm@org1.test')
    const bmRow = (await request(app).get('/api/v1/employees?role=branch_manager').set(as(owner.token))).body.data[0]
    await request(app).patch(`/api/v1/employees/${bmRow.id}`).set(as(owner.token)).send({ branchId: b.id }).expect(200)
    // branch manager is scoped to their branch: owner and agent (no branch) are invisible to them
    const bmList = await request(app).get('/api/v1/employees').set(as(bm.token))
    expect(bmList.status).toBe(200)
    expect(bmList.body.data.map((e) => e.role)).toEqual(['branch_manager'])
    expect((await request(app).patch(`/api/v1/employees/${ownerRow.id}/status`).set(as(bm.token)).send({ status: 'inactive' })).status).toBe(404)
  })
  it('keeps employee records private between organizations', async () => {
    const { agentRow } = await setup()
    const o2 = await registerOrg(2)
    expect((await request(app).get(`/api/v1/employees/${agentRow.id}`).set(as(o2.token))).status).toBe(404)
    expect((await request(app).patch(`/api/v1/employees/${agentRow.id}/status`).set(as(o2.token)).send({ status: 'inactive' })).status).toBe(404)
    expect((await request(app).delete(`/api/v1/employees/${agentRow.id}`).set(as(o2.token))).status).toBe(404)
    expect((await request(app).get('/api/v1/employees?search=agent').set(as(o2.token))).body.meta.total).toBe(0)
  })
  it('lists and revokes pending invitations', async () => {
    const { owner } = await setup()
    await request(app).post('/api/v1/organizations/invitations').set(as(owner.token)).send({ email: 'new@org1.test', role: 'accountant' }).expect(201)
    const inv = (await request(app).get('/api/v1/employees/invitations').set(as(owner.token))).body.data
    expect(inv).toHaveLength(1)
    await request(app).delete(`/api/v1/employees/invitations/${inv[0].id}`).set(as(owner.token)).expect(200)
    expect((await request(app).get('/api/v1/employees/invitations').set(as(owner.token))).body.data).toHaveLength(0)
  })
})
