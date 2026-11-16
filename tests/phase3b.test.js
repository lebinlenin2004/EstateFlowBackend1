import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app, request, outbox, registerOrg, addMember } from './helpers.js'

let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); outbox.length = 0 })
const as = (t) => ({ Authorization: `Bearer ${t}` })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const prop = (t, o = {}) => request(app).post('/api/v1/properties').set(as(t)).send({ title: 'Skyline Heights 3BHK', propertyType: 'apartment', listingType: 'sale', address: { city: 'Kozhikode', locality: 'Palazhi' }, price: 7500000, bedrooms: 3, bathrooms: 2, area: 1450, amenities: ['Gym', 'Parking'], ...o })
const cust = (t, o = {}) => request(app).post('/api/v1/customers').set(as(t)).send({ name: 'Arun Nair', phone: '+91 98765 43210', ...o })
const meId = async (t) => (await request(app).get('/api/v1/auth/me').set(as(t))).body.data.user.id

describe('properties', () => {
  it('creates with sequential codes and integer money, and returns the full record', async () => {
    const o = await registerOrg(1)
    const a = await prop(o.token)
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({ code: 'PR-0001', price: 7500000, priceMinor: 750000000, status: 'available', specs: { bedrooms: 3 }, amenities: ['gym', 'parking'] })
    expect((await prop(o.token, { title: 'Second home' })).body.data.code).toBe('PR-0002')
  })
  it('filters, sorts and paginates', async () => {
    const o = await registerOrg(1)
    await prop(o.token, { title: 'Cheap flat', price: 3000000, bedrooms: 2 })
    await prop(o.token, { title: 'Big villa', propertyType: 'villa', price: 20000000, bedrooms: 5, address: { city: 'Kochi' }, amenities: ['pool'] })
    await prop(o.token, { title: 'Rent flat', listingType: 'rent', price: 25000 })
    const get = (q) => request(app).get(`/api/v1/properties?${q}`).set(as(o.token))
    expect((await get('propertyType=villa')).body.meta.total).toBe(1)
    expect((await get('city=kochi')).body.meta.total).toBe(1)
    expect((await get('listingType=rent')).body.meta.total).toBe(1)
    expect((await get('minPrice=2500000&maxPrice=5000000')).body.data[0].title).toBe('Cheap flat')
    expect((await get('bedrooms=4')).body.meta.total).toBe(1)
    expect((await get('amenities=pool')).body.meta.total).toBe(1)
    expect((await get('search=villa')).body.meta.total).toBe(1)
    expect((await get('sort=price_desc&limit=2')).body.data.map((p) => p.title)).toEqual(['Big villa', 'Cheap flat'])
    expect((await get('limit=2&page=2')).body.data).toHaveLength(1)
    const summary = (await request(app).get('/api/v1/properties/summary').set(as(o.token))).body.data
    expect(summary).toMatchObject({ total: 3, byPropertyType: { apartment: 2, villa: 1 }, byListingType: { sale: 2, rent: 1 } })
  })
  it('finds properties within a radius', async () => {
    const o = await registerOrg(1)
    await prop(o.token, { title: 'Near', latitude: 11.2588, longitude: 75.7804 })
    await prop(o.token, { title: 'Far', latitude: 9.9312, longitude: 76.2673 })
    const near = await request(app).get('/api/v1/properties?lat=11.25&lng=75.78&radiusKm=10').set(as(o.token))
    expect(near.body.data.map((p) => p.title)).toEqual(['Near'])
  })
  it('enforces status rules and records history', async () => {
    const o = await registerOrg(1)
    const p = (await prop(o.token)).body.data
    expect((await request(app).patch(`/api/v1/properties/${p.id}/status`).set(as(o.token)).send({ status: 'rented' })).status).toBe(400)
    await request(app).patch(`/api/v1/properties/${p.id}/status`).set(as(o.token)).send({ status: 'sold', note: 'Closed by Fathima' }).expect(200)
    await request(app).patch(`/api/v1/properties/${p.id}`).set(as(o.token)).send({ price: 7200000 }).expect(200)
    const h = (await request(app).get(`/api/v1/properties/${p.id}/history`).set(as(o.token))).body.data
    expect(h.map((x) => x.action)).toEqual(['updated', 'status_changed', 'created'])
    expect(h[0].changes.priceMinor).toEqual([750000000, 720000000])
  })
  it('assigns only valid agents and keeps agents read-only', async () => {
    const o = await registerOrg(1)
    const agent = await addMember(o, 'sales_agent', 'agent@org1.test')
    const p = (await prop(o.token)).body.data
    const agentId = await meId(agent.token)
    expect((await request(app).patch(`/api/v1/properties/${p.id}/assign`).set(as(o.token)).send({ agentId })).body.data.assignedAgent.id).toBe(agentId)
    expect((await request(app).patch(`/api/v1/properties/${p.id}/assign`).set(as(o.token)).send({ agentId: new mongoose.Types.ObjectId().toString() })).status).toBe(400)
    expect((await request(app).get('/api/v1/properties').set(as(agent.token))).status).toBe(200)
    expect((await prop(agent.token)).status).toBe(403)
    expect((await request(app).delete(`/api/v1/properties/${p.id}`).set(as(agent.token))).status).toBe(403)
  })
  it('archives, hides and restores', async () => {
    const o = await registerOrg(1)
    const p = (await prop(o.token)).body.data
    await request(app).delete(`/api/v1/properties/${p.id}`).set(as(o.token)).expect(200)
    expect((await request(app).get(`/api/v1/properties/${p.id}`).set(as(o.token))).status).toBe(404)
    expect((await request(app).get('/api/v1/properties').set(as(o.token))).body.meta.total).toBe(0)
    expect((await request(app).get('/api/v1/properties?archived=true').set(as(o.token))).body.meta.total).toBe(1)
    expect((await request(app).post(`/api/v1/properties/${p.id}/restore`).set(as(o.token))).status).toBe(200)
  })
  it('uploads verified images, sets a cover, removes images', async () => {
    const o = await registerOrg(1)
    const p = (await prop(o.token)).body.data
    const up = await request(app).post(`/api/v1/properties/${p.id}/images`).set(as(o.token)).attach('images', PNG, 'a.png').attach('images', PNG, 'b.png')
    expect(up.status).toBe(201)
    expect(up.body.data.images).toHaveLength(2)
    expect(up.body.data.images[0].isCover).toBe(true)
    const [first, second] = up.body.data.images
    expect((await request(app).get(first.url)).status).toBe(200)
    const cover = await request(app).patch(`/api/v1/properties/${p.id}/images/${second.id}/cover`).set(as(o.token))
    expect(cover.body.data.coverImage).toBe(second.url)
    const del = await request(app).delete(`/api/v1/properties/${p.id}/images/${second.id}`).set(as(o.token))
    expect(del.body.data.images).toHaveLength(1)
    expect(del.body.data.images[0].isCover).toBe(true)
    const bad = await request(app).post(`/api/v1/properties/${p.id}/images`).set(as(o.token)).attach('images', Buffer.from('<?php echo 1; ?> padding padding'), 'x.png')
    expect(bad.status).toBe(400)
  })
  it('hides owner contact details from roles without owner:manage', async () => {
    const o = await registerOrg(1)
    const agent = await addMember(o, 'sales_agent', 'agent@org1.test')
    const owner = (await request(app).post('/api/v1/owners').set(as(o.token)).send({ name: 'K. Menon', phone: '9000000001' })).body.data
    const p = (await prop(o.token, { ownerId: owner.id })).body.data
    expect((await request(app).get(`/api/v1/properties/${p.id}`).set(as(o.token))).body.data.owner.phone).toBe('9000000001')
    const seen = (await request(app).get(`/api/v1/properties/${p.id}`).set(as(agent.token))).body.data.owner
    expect(seen).toEqual({ id: owner.id, name: 'K. Menon' })
  })
  it('scopes branch managers to their branch', async () => {
    const o = await registerOrg(1)
    const b = (await request(app).post('/api/v1/branches').set(as(o.token)).send({ name: 'Main' })).body.data
    const bm = await addMember(o, 'branch_manager', 'bm@org1.test')
    const bmRow = (await request(app).get('/api/v1/employees?role=branch_manager').set(as(o.token))).body.data[0]
    await request(app).patch(`/api/v1/employees/${bmRow.id}`).set(as(o.token)).send({ branchId: b.id }).expect(200)
    const other = (await prop(o.token, { title: 'No branch' })).body.data
    const mine = (await prop(bm.token, { title: 'Branch flat' })).body.data
    expect(mine.branch.id).toBe(b.id)
    const list = (await request(app).get('/api/v1/properties').set(as(bm.token))).body.data
    expect(list.map((p) => p.title)).toEqual(['Branch flat'])
    expect((await request(app).get(`/api/v1/properties/${other.id}`).set(as(bm.token))).status).toBe(404)
  })
  it('keeps organizations apart: no read, update, status, assign, image, history or owner link across tenants', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    const p = (await prop(o1.token)).body.data
    const url = `/api/v1/properties/${p.id}`
    for (const [m, u, body] of [['get', url], ['patch', url, { title: 'x' }], ['delete', url], ['patch', `${url}/status`, { status: 'inactive' }], ['get', `${url}/history`], ['post', `${url}/restore`]])
      expect((await request(app)[m](u).set(as(o2.token)).send(body)).status).toBe(404)
    expect((await request(app).post(`${url}/images`).set(as(o2.token)).attach('images', PNG, 'a.png')).status).toBe(404)
    expect((await request(app).get('/api/v1/properties').set(as(o2.token))).body.meta.total).toBe(0)
    expect((await request(app).get('/api/v1/properties/summary').set(as(o2.token))).body.data.total).toBe(0)
    const owner1 = (await request(app).post('/api/v1/owners').set(as(o1.token)).send({ name: 'O1 Owner', phone: '9000000002' })).body.data
    expect((await prop(o2.token, { ownerId: owner1.id })).status).toBe(400)
  })
})

describe('property owners', () => {
  it('manages owners and blocks archiving while properties are linked', async () => {
    const o = await registerOrg(1)
    const owner = (await request(app).post('/api/v1/owners').set(as(o.token)).send({ name: 'K. Menon', phone: '9000000001' })).body.data
    await prop(o.token, { ownerId: owner.id })
    expect((await request(app).get(`/api/v1/owners/${owner.id}`).set(as(o.token))).body.data.propertyCount).toBe(1)
    expect((await request(app).delete(`/api/v1/owners/${owner.id}`).set(as(o.token))).status).toBe(409)
    expect((await request(app).get('/api/v1/owners?search=menon').set(as(o.token))).body.meta.total).toBe(1)
  })
  it('is closed to sales agents and other organizations', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    const agent = await addMember(o1, 'sales_agent', 'agent@org1.test')
    const owner = (await request(app).post('/api/v1/owners').set(as(o1.token)).send({ name: 'K. Menon', phone: '9000000001' })).body.data
    expect((await request(app).get('/api/v1/owners').set(as(agent.token))).status).toBe(403)
    expect((await request(app).get(`/api/v1/owners/${owner.id}`).set(as(o2.token))).status).toBe(404)
  })
})

describe('customers', () => {
  it('creates, normalizes phone, stores budget in paise and blocks duplicate phones', async () => {
    const o = await registerOrg(1)
    const c = await cust(o.token, { budget: { min: 5000000, max: 8000000 }, preferredLocations: ['Palazhi'] })
    expect(c.status).toBe(201)
    expect(c.body.data).toMatchObject({ phone: '+919876543210', budget: { min: 5000000, max: 8000000 } })
    const dup = await cust(o.token, { name: 'Someone else' })
    expect(dup.status).toBe(409)
    expect(dup.body.errors[0].existingId).toBe(c.body.data.id)
  })
  it('searches by name and phone and filters by type', async () => {
    const o = await registerOrg(1)
    await cust(o.token)
    await cust(o.token, { name: 'Meera Joseph', phone: '9000011111', customerType: 'tenant' })
    const get = (q) => request(app).get(`/api/v1/customers?${q}`).set(as(o.token))
    expect((await get('search=meera')).body.meta.total).toBe(1)
    expect((await get('search=98765')).body.data[0].name).toBe('Arun Nair')
    expect((await get('customerType=tenant')).body.meta.total).toBe(1)
  })
  it('limits sales agents to their own customers', async () => {
    const o = await registerOrg(1)
    const a1 = await addMember(o, 'sales_agent', 'a1@org1.test')
    const a2 = await addMember(o, 'sales_agent', 'a2@org1.test')
    const mine = (await cust(a1.token)).body.data
    expect(mine.assignedAgent.id).toBe(await meId(a1.token))
    expect((await request(app).get(`/api/v1/customers/${mine.id}`).set(as(a2.token))).status).toBe(404)
    expect((await request(app).get('/api/v1/customers').set(as(a2.token))).body.meta.total).toBe(0)
    expect((await request(app).get('/api/v1/customers').set(as(o.token))).body.meta.total).toBe(1)
    // a2 cannot learn that this phone exists, nor see its id
    const dup = await cust(a2.token)
    expect(dup.status).toBe(409)
    expect(dup.body.errors).toEqual([])
  })
  it('archives and restores, and isolates organizations', async () => {
    const o1 = await registerOrg(1)
    const o2 = await registerOrg(2)
    const c = (await cust(o1.token)).body.data
    expect((await request(app).get(`/api/v1/customers/${c.id}`).set(as(o2.token))).status).toBe(404)
    expect((await request(app).patch(`/api/v1/customers/${c.id}`).set(as(o2.token)).send({ name: 'Mine' })).status).toBe(404)
    expect((await cust(o2.token)).status).toBe(201) // same phone is fine in another organization
    await request(app).delete(`/api/v1/customers/${c.id}`).set(as(o1.token)).expect(200)
    expect((await request(app).get('/api/v1/customers').set(as(o1.token))).body.meta.total).toBe(0)
    expect((await request(app).post(`/api/v1/customers/${c.id}/restore`).set(as(o1.token))).status).toBe(200)
  })
})
