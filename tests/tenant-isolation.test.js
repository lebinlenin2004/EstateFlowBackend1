import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app, request, registerOrg, addMember } from './helpers.js'
import { tenantScope } from '../src/models/plugins/tenantScope.js'
import { runWithTenant } from '../src/utils/tenantContext.js'

const Widget = mongoose.model('IsoWidget', new mongoose.Schema({ name: String, price: Number }).plugin(tenantScope))
let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })
beforeEach(() => mongoose.connection.db.dropDatabase())

const A = new mongoose.Types.ObjectId().toString()
const B = new mongoose.Types.ObjectId().toString()
const asA = (fn) => runWithTenant({ orgId: A }, fn)
const asB = (fn) => runWithTenant({ orgId: B }, fn)

describe('Organization B cannot reach Organization A data, even knowing the id', () => {
  let docId
  beforeEach(async () => { docId = (await asA(() => Widget.create({ name: 'A secret', price: 100 }))).id })

  it('stamps the organization from context, not from input', async () => {
    const w = await asA(() => Widget.create({ name: 'x' }))
    expect(String(w.organization)).toBe(A)
  })
  it('hides documents from findById, find and count', async () => {
    expect(await asB(() => Widget.findById(docId))).toBeNull()
    expect(await asB(() => Widget.find({ _id: docId }))).toHaveLength(0)
    expect(await asB(() => Widget.countDocuments())).toBe(0)
    expect(await asA(() => Widget.countDocuments())).toBe(1)
  })
  it('cannot update through any update path', async () => {
    await asB(() => Widget.updateOne({ _id: docId }, { price: 1 }))
    await asB(() => Widget.updateMany({}, { price: 1 }))
    await asB(() => Widget.findByIdAndUpdate(docId, { price: 1 }))
    expect((await asA(() => Widget.findById(docId))).price).toBe(100)
  })
  it('cannot move a document into its own organization', async () => {
    await asB(() => Widget.updateOne({ _id: docId }, { organization: B }))
    expect(await asA(() => Widget.findById(docId))).not.toBeNull()
  })
  it('cannot delete', async () => {
    await asB(() => Widget.deleteOne({ _id: docId }))
    await asB(() => Widget.deleteMany({}))
    await asB(() => Widget.findByIdAndDelete(docId))
    expect(await asA(() => Widget.countDocuments())).toBe(1)
  })
  it('cannot read through aggregation', async () => {
    expect(await asB(() => Widget.aggregate([{ $group: { _id: null, total: { $sum: '$price' } } }]))).toEqual([])
    expect((await asA(() => Widget.aggregate([{ $group: { _id: null, total: { $sum: '$price' } } }])))[0].total).toBe(100)
  })
  it('cannot insert into another organization', async () => {
    await expect(asB(() => Widget.insertMany([{ name: 'bad', organization: A }]))).rejects.toThrow(/Cross-tenant/)
  })
})

describe('API level isolation', () => {
  it('lists only the caller organization members', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    await addMember(o1, 'sales_agent', 'agent@org1.test')
    const r1 = await request(app).get('/api/v1/organizations/members').set('Authorization', `Bearer ${o1.token}`)
    const r2 = await request(app).get('/api/v1/organizations/members').set('Authorization', `Bearer ${o2.token}`)
    expect(r1.body.meta.total).toBe(2)
    expect(r2.body.meta.total).toBe(1)
    expect(JSON.stringify(r2.body)).not.toMatch(/org1\.test/)
  })
  it('blocks a token whose membership id belongs to another organization', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    const { signAccessToken } = await import('../src/utils/tokens.js')
    const me1 = JSON.parse(Buffer.from(o1.token.split('.')[1], 'base64url'))
    const forged = signAccessToken({ sub: me1.sub, org: o2.orgId, mid: me1.mid, role: 'owner' })
    expect((await request(app).get('/api/v1/organizations/members').set('Authorization', `Bearer ${forged}`)).status).toBe(401)
  })
})
