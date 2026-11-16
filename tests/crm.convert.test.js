import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { app, request, registerOrg, addMember } from './helpers.js'

// Lead conversion uses a transaction, which MongoDB only allows on a replica set.
let rs
beforeAll(async () => { rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(rs.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await rs?.stop() })
beforeEach(async () => { await mongoose.connection.db.dropDatabase() })
const as = (t) => ({ Authorization: `Bearer ${t}` })
const mkLead = (t) => request(app).post('/api/v1/leads').set(as(t)).send({ contact: { name: 'Arun Nair', phone: '9876543210' } })
const mkProp = (t, o = {}) => request(app).post('/api/v1/properties').set(as(t)).send({ title: 'Skyline Heights', propertyType: 'apartment', listingType: 'sale', address: { city: 'Kozhikode' }, price: 7500000, ...o })

describe('lead conversion', () => {
  it('creates the deal, marks the property sold and closes the lead together', async () => {
    const owner = await registerOrg(1)
    const p = (await mkProp(owner.token)).body.data
    const l = (await mkLead(owner.token)).body.data
    const res = await request(app).post(`/api/v1/leads/${l.id}/convert`).set(as(owner.token)).send({ propertyId: p.id, dealValue: 7400000.5 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'converted', deal: { value: 7400000.5, type: 'sale' } })
    expect((await request(app).get(`/api/v1/properties/${p.id}`).set(as(owner.token))).body.data.status).toBe('sold')
    const h = (await request(app).get(`/api/v1/properties/${p.id}/history`).set(as(owner.token))).body.data
    expect(h[0]).toMatchObject({ action: 'status_changed' })
    expect((await request(app).get('/api/v1/leads/stats').set(as(owner.token))).body.data).toMatchObject({ converted: 1, conversionRate: 100 })
  })
  it('rolls everything back when a step fails', async () => {
    const owner = await registerOrg(1)
    const p = (await mkProp(owner.token)).body.data
    await request(app).patch(`/api/v1/properties/${p.id}/status`).set(as(owner.token)).send({ status: 'inactive' })
    const l = (await mkLead(owner.token)).body.data
    expect((await request(app).post(`/api/v1/leads/${l.id}/convert`).set(as(owner.token)).send({ propertyId: p.id, dealValue: 100 })).status).toBe(409)
    const after = (await request(app).get(`/api/v1/leads/${l.id}`).set(as(owner.token))).body.data
    expect(after).toMatchObject({ status: 'new', deal: null })
  })
  it('handles rent deals, blocks double conversion, closed leads and other organizations', async () => {
    const owner = await registerOrg(1)
    const other = await registerOrg(2)
    const rent = (await mkProp(owner.token, { listingType: 'rent', price: 25000 })).body.data
    const l = (await mkLead(owner.token)).body.data
    await request(app).post(`/api/v1/leads/${l.id}/convert`).set(as(owner.token)).send({ propertyId: rent.id, dealValue: 25000 }).expect(200)
    expect((await request(app).get(`/api/v1/properties/${rent.id}`).set(as(owner.token))).body.data.status).toBe('rented')
    expect((await request(app).post(`/api/v1/leads/${l.id}/convert`).set(as(owner.token)).send({ dealValue: 1, dealType: 'sale' })).status).toBe(409)
    expect((await request(app).patch(`/api/v1/leads/${l.id}/status`).set(as(owner.token)).send({ status: 'contacted' })).status).toBe(409)
    const l2 = (await request(app).post('/api/v1/leads').set(as(owner.token)).send({ contact: { name: 'Meera', phone: '9000011111' } })).body.data
    await request(app).patch(`/api/v1/leads/${l2.id}/status`).set(as(owner.token)).send({ status: 'lost', lostReason: 'No budget' })
    expect((await request(app).post(`/api/v1/leads/${l2.id}/convert`).set(as(owner.token)).send({ dealValue: 1, dealType: 'sale' })).status).toBe(400)
    const l3 = (await request(app).post('/api/v1/leads').set(as(owner.token)).send({ contact: { name: 'Third', phone: '9000033333' } })).body.data
    expect((await request(app).post(`/api/v1/leads/${l3.id}/convert`).set(as(other.token)).send({ dealValue: 1, dealType: 'sale' })).status).toBe(404)
    const agent = await addMember(owner, 'sales_agent', 'a@org1.test')
    expect((await request(app).post(`/api/v1/leads/${l3.id}/convert`).set(as(agent.token)).send({ dealValue: 1, dealType: 'sale' })).status).toBe(404) // not their lead
  })
})
