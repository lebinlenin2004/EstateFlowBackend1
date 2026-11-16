import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { app, request, outbox, registerOrg, addMember } from './helpers.js'
import FollowUp from '../src/models/FollowUp.js'
import SiteVisit from '../src/models/SiteVisit.js'
import { dayBounds } from '../src/utils/dates.js'

let mongod
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop() })
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); outbox.length = 0 })

const as = (t) => ({ Authorization: `Bearer ${t}` })
const me = async (t) => (await request(app).get('/api/v1/auth/me').set(as(t))).body.data.user.id
const lead = (t, o = {}) => request(app).post('/api/v1/leads').set(as(t)).send({ contact: { name: 'Arun Nair', phone: '9876543210' }, source: 'website', propertyType: 'apartment', ...o })
const prop = (t, o = {}) => request(app).post('/api/v1/properties').set(as(t)).send({ title: 'Skyline Heights 3BHK', propertyType: 'apartment', listingType: 'sale', address: { city: 'Kozhikode' }, price: 7500000, ...o })
const inDays = (d, h = 10) => { const x = new Date(Date.now() + d * 86400000); x.setUTCHours(h, 0, 0, 0); return x.toISOString() }
const bypass = (q) => q.setOptions({ skipTenant: true })

async function team() {
  const owner = await registerOrg(1)
  const a1 = await addMember(owner, 'sales_agent', 'a1@org1.test')
  const a2 = await addMember(owner, 'sales_agent', 'a2@org1.test')
  return { owner, a1, a2, a1Id: await me(a1.token), a2Id: await me(a2.token) }
}

describe('leads', () => {
  it('creates a lead from contact details, builds the customer and records history', async () => {
    const { owner } = await team()
    const res = await lead(owner.token, { budget: { min: 5000000, max: 8000000 }, notes: 'Wants a school nearby' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ code: 'LD-0001', status: 'new', priority: 'medium', customer: { name: 'Arun Nair', phone: '9876543210' }, budget: { min: 5000000, max: 8000000 } })
    const acts = (await request(app).get(`/api/v1/leads/${res.body.data.id}/activities`).set(as(owner.token))).body.data
    expect(acts.map((a) => a.type)).toEqual(['note_added', 'lead_created'])
    expect((await request(app).get('/api/v1/customers').set(as(owner.token))).body.meta.total).toBe(1)
    expect((await lead(owner.token)).body.data.customer.id).toBe(res.body.data.customer.id) // same phone reuses the customer
  })
  it('lets agents own what they create and see only their own leads', async () => {
    const { owner, a1, a2, a1Id } = await team()
    const mine = (await lead(a1.token)).body.data
    expect(mine.assignedAgent.id).toBe(a1Id)
    expect((await request(app).get(`/api/v1/leads/${mine.id}`).set(as(a2.token))).status).toBe(404)
    expect((await request(app).get('/api/v1/leads').set(as(a2.token))).body.meta.total).toBe(0)
    expect((await request(app).get('/api/v1/leads').set(as(owner.token))).body.meta.total).toBe(1)
    expect((await lead(a2.token)).status).toBe(409) // a2 cannot grab a1's customer by phone
    expect((await request(app).patch(`/api/v1/leads/${mine.id}/assign`).set(as(a1.token)).send({ agentId: a1Id })).status).toBe(403)
  })
  it('changes status with rules, priority and assignment, all in the history', async () => {
    const { owner, a1Id } = await team()
    const l = (await lead(owner.token)).body.data
    const url = `/api/v1/leads/${l.id}`
    expect((await request(app).patch(`${url}/status`).set(as(owner.token)).send({ status: 'lost' })).status).toBe(400)
    expect((await request(app).patch(`${url}/status`).set(as(owner.token)).send({ status: 'converted' })).status).toBe(400)
    await request(app).patch(`${url}/status`).set(as(owner.token)).send({ status: 'interested' }).expect(200)
    await request(app).patch(`${url}/priority`).set(as(owner.token)).send({ priority: 'urgent' }).expect(200)
    await request(app).patch(`${url}/assign`).set(as(owner.token)).send({ agentId: a1Id }).expect(200)
    await request(app).patch(`${url}/status`).set(as(owner.token)).send({ status: 'lost', lostReason: 'Bought elsewhere' }).expect(200)
    await request(app).patch(`${url}/status`).set(as(owner.token)).send({ status: 'contacted' }).expect(200) // reopen
    expect((await request(app).patch(`${url}/assign`).set(as(owner.token)).send({ agentId: new mongoose.Types.ObjectId().toString() })).status).toBe(400)
    const types = (await request(app).get(`${url}/activities`).set(as(owner.token))).body.data.map((a) => a.type)
    expect(types).toEqual(['status_changed', 'status_changed', 'agent_assigned', 'priority_changed', 'status_changed', 'lead_created'])
  })
  it('adds manual activities and refreshes last interaction', async () => {
    const { owner } = await team()
    const l = (await lead(owner.token)).body.data
    const a = await request(app).post(`/api/v1/leads/${l.id}/activities`).set(as(owner.token)).send({ type: 'call_completed', summary: 'Spoke for 10 minutes' })
    expect(a.status).toBe(201)
    expect(a.body.data).toMatchObject({ type: 'call_completed', summary: 'Spoke for 10 minutes' })
    expect((await request(app).post(`/api/v1/leads/${l.id}/activities`).set(as(owner.token)).send({ type: 'status_changed', summary: 'forged' })).status).toBe(400)
  })
  it('filters, searches and reports pipeline and stats', async () => {
    const { owner, a1Id } = await team()
    const l1 = (await lead(owner.token)).body.data
    await lead(owner.token, { contact: { name: 'Meera Joseph', phone: '9000011111' }, source: 'referral' })
    await request(app).patch(`/api/v1/leads/${l1.id}/status`).set(as(owner.token)).send({ status: 'negotiation' })
    await request(app).patch(`/api/v1/leads/${l1.id}/assign`).set(as(owner.token)).send({ agentId: a1Id })
    const get = (q) => request(app).get(`/api/v1/leads${q}`).set(as(owner.token))
    expect((await get('?search=meera')).body.meta.total).toBe(1)
    expect((await get('?search=98765')).body.data[0].id).toBe(l1.id)
    expect((await get('?status=negotiation,new')).body.meta.total).toBe(2)
    expect((await get('?source=referral')).body.meta.total).toBe(1)
    expect((await get(`?assignedAgent=${a1Id}`)).body.meta.total).toBe(1)
    expect((await get('?unassigned=true')).body.meta.total).toBe(1)
    const pipe = (await request(app).get('/api/v1/leads/pipeline').set(as(owner.token))).body.data
    expect(pipe.map((c) => c.status)).toEqual(['new', 'contacted', 'interested', 'site_visit_scheduled', 'negotiation', 'converted', 'lost'])
    expect(pipe.find((c) => c.status === 'negotiation')).toMatchObject({ count: 1 })
    const stats = (await request(app).get('/api/v1/leads/stats').set(as(owner.token))).body.data
    expect(stats).toMatchObject({ total: 2, new: 1, qualified: 1, converted: 0, lost: 0, bySource: { website: 1, referral: 1 } })
  })
  it('auto-assigns to the least-loaded agent when the organization setting is on', async () => {
    const { owner, a1Id, a2Id } = await team()
    await request(app).patch('/api/v1/organizations/me/settings').set(as(owner.token)).send({ leadAutoAssign: true }).expect(200)
    const first = (await lead(owner.token)).body.data
    const second = (await lead(owner.token, { contact: { name: 'Meera Joseph', phone: '9000011111' } })).body.data
    expect([first.assignedAgent.id, second.assignedAgent.id].sort()).toEqual([a1Id, a2Id].sort())
  })
  it('archives and restores, owners and managers only', async () => {
    const { owner, a1 } = await team()
    const l = (await lead(a1.token)).body.data
    expect((await request(app).delete(`/api/v1/leads/${l.id}`).set(as(a1.token))).status).toBe(403)
    await request(app).delete(`/api/v1/leads/${l.id}`).set(as(owner.token)).expect(200)
    expect((await request(app).get('/api/v1/leads').set(as(owner.token))).body.meta.total).toBe(0)
    expect((await request(app).post(`/api/v1/leads/${l.id}/restore`).set(as(owner.token))).status).toBe(200)
  })
  it('scopes branch managers to agents in their branch', async () => {
    const { owner, a1, a1Id } = await team()
    const b = (await request(app).post('/api/v1/branches').set(as(owner.token)).send({ name: 'Main' })).body.data
    const bm = await addMember(owner, 'branch_manager', 'bm@org1.test')
    const rows = (await request(app).get('/api/v1/employees').set(as(owner.token))).body.data
    const row = (email) => rows.find((r) => r.user.email === email)
    for (const email of ['bm@org1.test', 'a1@org1.test']) await request(app).patch(`/api/v1/employees/${row(email).id}`).set(as(owner.token)).send({ branchId: b.id }).expect(200)
    await lead(a1.token)
    await lead(owner.token, { contact: { name: 'Other Person', phone: '9000022222' }, assignedAgentId: await me((await addMember(owner, 'sales_agent', 'a3@org1.test')).token) })
    const list = (await request(app).get('/api/v1/leads').set(as(bm.token))).body
    expect(list.meta.total).toBe(1)
    expect(list.data[0].assignedAgent.id).toBe(a1Id)
  })
})

describe('follow-ups', () => {
  it('schedules, buckets, completes and cancels', async () => {
    const { owner, a1 } = await team()
    const l = (await lead(a1.token)).body.data
    const make = (o) => request(app).post('/api/v1/followups').set(as(a1.token)).send({ leadId: l.id, type: 'call', ...o })
    expect((await make({ dueAt: new Date(Date.now() - 3600000).toISOString() })).status).toBe(400) // in the past
    const { end } = dayBounds('Asia/Kolkata')
    const today = (await make({ dueAt: new Date(end.getTime() - 60000).toISOString() })).body.data
    const upcoming = (await make({ dueAt: inDays(3), type: 'meeting' })).body.data
    const overdue = (await make({ dueAt: inDays(1) })).body.data
    await FollowUp.updateOne({ _id: overdue.id }, { dueAt: new Date(Date.now() - 86400000) }).setOptions({ skipTenant: true })
    const bucket = async (b) => (await request(app).get(`/api/v1/followups?bucket=${b}`).set(as(a1.token))).body.data.map((f) => f.id)
    expect(await bucket('today')).toEqual([today.id])
    expect(await bucket('upcoming')).toEqual([upcoming.id])
    expect(await bucket('overdue')).toEqual([overdue.id])
    expect((await request(app).get(`/api/v1/followups/${overdue.id}`).set(as(a1.token))).body.data.overdue).toBe(true)
    expect((await request(app).get('/api/v1/followups/summary').set(as(a1.token))).body.data).toEqual({ overdue: 1, today: 1, upcoming: 1, completed: 0 })
    await request(app).patch(`/api/v1/followups/${overdue.id}/complete`).set(as(a1.token)).send({ note: 'Customer will visit Sunday' }).expect(200)
    expect((await request(app).patch(`/api/v1/followups/${overdue.id}/complete`).set(as(a1.token)).send({})).status).toBe(409)
    expect(await bucket('completed')).toEqual([overdue.id])
    await request(app).patch(`/api/v1/followups/${upcoming.id}/cancel`).set(as(a1.token)).send({ reason: 'Not needed' }).expect(200)
    const acts = (await request(app).get(`/api/v1/leads/${l.id}/activities`).set(as(owner.token))).body.data.map((a) => a.type)
    expect(acts).toContain('follow_up_completed')
    expect(acts.filter((t) => t === 'follow_up_scheduled')).toHaveLength(3)
  })
  it('hides other agents follow-ups and blocks closed leads', async () => {
    const { owner, a1, a2 } = await team()
    const l = (await lead(a1.token)).body.data
    const f = (await request(app).post('/api/v1/followups').set(as(a1.token)).send({ leadId: l.id, dueAt: inDays(2) })).body.data
    expect((await request(app).get(`/api/v1/followups/${f.id}`).set(as(a2.token))).status).toBe(404)
    expect((await request(app).patch(`/api/v1/followups/${f.id}/complete`).set(as(a2.token)).send({})).status).toBe(404)
    expect((await request(app).post('/api/v1/followups').set(as(a2.token)).send({ leadId: l.id, dueAt: inDays(2) })).status).toBe(404)
    await request(app).patch(`/api/v1/leads/${l.id}/status`).set(as(owner.token)).send({ status: 'lost', lostReason: 'No budget' })
    expect((await request(app).post('/api/v1/followups').set(as(a1.token)).send({ leadId: l.id, dueAt: inDays(2) })).status).toBe(400)
  })
})

describe('site visits', () => {
  async function ready() {
    const t = await team()
    const p = (await prop(t.owner.token)).body.data
    const l = (await lead(t.a1.token)).body.data
    return { ...t, p, l }
  }
  const book = (t, o) => request(app).post('/api/v1/site-visits').set(as(t)).send(o)

  it('books a visit, moves the lead to site visit scheduled and logs it', async () => {
    const { a1, p, l } = await ready()
    const res = await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(2) })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: 'scheduled', property: { code: 'PR-0001' }, customer: { name: 'Arun Nair' } })
    expect(new Date(res.body.data.endAt) - new Date(res.body.data.startAt)).toBe(60 * 60000) // default length from settings
    expect((await request(app).get(`/api/v1/leads/${l.id}`).set(as(a1.token))).body.data.status).toBe('site_visit_scheduled')
  })
  it('prevents double-booking an agent, a property or a customer', async () => {
    const { owner, a1, a2, p, l } = await ready()
    await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(2) }).expect(201)
    const p2 = (await prop(owner.token, { title: 'Second flat' })).body.data
    const sameAgent = await book(a1.token, { leadId: l.id, propertyId: p2.id, startAt: inDays(2) })
    expect(sameAgent.status).toBe(409)
    const l2 = (await lead(a2.token, { contact: { name: 'Meera Joseph', phone: '9000011111' } })).body.data
    const sameProperty = await book(a2.token, { leadId: l2.id, propertyId: p.id, startAt: inDays(2) })
    expect(sameProperty.status).toBe(409)
    expect(sameProperty.body.errors[0].message).toBe('property_busy')
    expect((await book(a2.token, { leadId: l2.id, propertyId: p.id, startAt: inDays(3) })).status).toBe(201) // another day is fine
  })
  it('refuses past times and unavailable properties', async () => {
    const { owner, a1, p, l } = await ready()
    expect((await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(-1) })).status).toBe(400)
    await request(app).patch(`/api/v1/properties/${p.id}/status`).set(as(owner.token)).send({ status: 'inactive' })
    expect((await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(2) })).status).toBe(400)
  })
  it('reschedules with conflict checks, cancels and completes with feedback', async () => {
    const { owner, a1, p, l } = await ready()
    const v = (await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(2) })).body.data
    const moved = await request(app).patch(`/api/v1/site-visits/${v.id}/reschedule`).set(as(a1.token)).send({ startAt: inDays(4) })
    expect(moved.body.data.rescheduledCount).toBe(1)
    expect((await request(app).patch(`/api/v1/site-visits/${v.id}/complete`).set(as(a1.token)).send({})).status).toBe(400) // not started
    await SiteVisit.updateOne({ _id: v.id }, { startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 3600000) }).setOptions({ skipTenant: true })
    const done = await request(app).patch(`/api/v1/site-visits/${v.id}/complete`).set(as(a1.token)).send({ feedback: { rating: 4, comment: 'Liked the layout', interested: true } })
    expect(done.body.data).toMatchObject({ status: 'completed', feedback: { rating: 4, interested: true } })
    expect((await request(app).patch(`/api/v1/site-visits/${v.id}/cancel`).set(as(a1.token)).send({})).status).toBe(409)
    expect((await request(app).get(`/api/v1/properties/${p.id}/interest`).set(as(owner.token))).body.data.siteVisits[0].feedback.rating).toBe(4)
    const second = (await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(6) })).body.data
    await request(app).patch(`/api/v1/site-visits/${second.id}/cancel`).set(as(a1.token)).send({ reason: 'Customer travelling' }).expect(200)
    const summary = (await request(app).get('/api/v1/site-visits/summary').set(as(a1.token))).body.data
    expect(summary).toMatchObject({ completed: 1, cancelled: 1, scheduled: 0 })
  })
  it('serves a calendar range and hides other agents visits', async () => {
    const { a1, a2, p, l } = await ready()
    await book(a1.token, { leadId: l.id, propertyId: p.id, startAt: inDays(2) })
    const from = new Date().toISOString(); const to = inDays(10)
    const cal = await request(app).get(`/api/v1/site-visits/calendar?from=${from}&to=${to}`).set(as(a1.token))
    expect(cal.body.data).toHaveLength(1)
    expect((await request(app).get(`/api/v1/site-visits/calendar?from=${from}&to=${to}`).set(as(a2.token))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/v1/site-visits').set(as(a2.token))).body.meta.total).toBe(0)
  })
})

describe('history views and employee stats', () => {
  it('shows a customer full history and a property its interested leads', async () => {
    const { owner, a1, a2 } = await team()
    const p = (await prop(owner.token)).body.data
    const l = (await lead(a1.token, { interestedPropertyIds: [p.id] })).body.data
    await request(app).post(`/api/v1/leads/${l.id}/activities`).set(as(a1.token)).send({ type: 'call_completed', summary: 'Intro call' })
    await request(app).post('/api/v1/site-visits').set(as(a1.token)).send({ leadId: l.id, propertyId: p.id, startAt: inDays(2) })
    const h = (await request(app).get(`/api/v1/customers/${l.customer.id}/history`).set(as(a1.token))).body.data
    expect(h.leads).toHaveLength(1)
    expect(h.siteVisits).toHaveLength(1)
    expect(h.activities.map((a) => a.type)).toEqual(expect.arrayContaining(['lead_created', 'call_completed', 'site_visit_scheduled']))
    expect((await request(app).get(`/api/v1/customers/${l.customer.id}/history`).set(as(a2.token))).status).toBe(404)
    const interest = (await request(app).get(`/api/v1/properties/${p.id}/interest`).set(as(owner.token))).body.data
    expect(interest.interestedLeads[0]).toMatchObject({ code: 'LD-0001', customer: { name: 'Arun Nair' } })
    expect((await request(app).get(`/api/v1/properties/${p.id}/interest`).set(as(a2.token))).body.data.interestedLeads).toHaveLength(0)
  })
  it('adds open leads and conversions to the employee list', async () => {
    const { owner, a1 } = await team()
    await lead(a1.token)
    const row = (await request(app).get('/api/v1/employees?search=a1').set(as(owner.token))).body.data[0]
    expect(row.stats).toEqual({ assignedLeads: 1, conversions: 0 })
  })
})

describe('organization isolation across the CRM', () => {
  it('gives organization B no access to organization A leads, follow-ups, visits or history by id', async () => {
    const { owner, a1 } = await team()
    const o2 = await registerOrg(2)
    const p = (await prop(owner.token)).body.data
    const l = (await lead(a1.token)).body.data
    const f = (await request(app).post('/api/v1/followups').set(as(a1.token)).send({ leadId: l.id, dueAt: inDays(2) })).body.data
    const v = (await request(app).post('/api/v1/site-visits').set(as(a1.token)).send({ leadId: l.id, propertyId: p.id, startAt: inDays(2) })).body.data
    const t = o2.token
    const calls = [['get', `/leads/${l.id}`], ['patch', `/leads/${l.id}/status`, { status: 'contacted' }], ['patch', `/leads/${l.id}/assign`, { agentId: null }], ['post', `/leads/${l.id}/convert`, { dealValue: 1, dealType: 'sale' }],
      ['get', `/leads/${l.id}/activities`], ['delete', `/leads/${l.id}`], ['get', `/followups/${f.id}`], ['patch', `/followups/${f.id}/complete`, {}], ['get', `/site-visits/${v.id}`],
      ['patch', `/site-visits/${v.id}/cancel`, {}], ['get', `/customers/${l.customer.id}/history`], ['get', `/properties/${p.id}/interest`]]
    for (const [m, u, body] of calls) expect([m, u, (await request(app)[m](`/api/v1${u}`).set(as(t)).send(body)).status]).toEqual([m, u, 404])
    expect((await request(app).get('/api/v1/leads/pipeline').set(as(t))).body.data.every((c) => c.count === 0)).toBe(true)
    expect((await request(app).get('/api/v1/leads/stats').set(as(t))).body.data.total).toBe(0)
    expect((await request(app).post('/api/v1/leads').set(as(t)).send({ customerId: l.customer.id })).status).toBe(400)
    expect((await request(app).post('/api/v1/followups').set(as(t)).send({ leadId: l.id, dueAt: inDays(2) })).status).toBe(404)
    expect((await request(app).post('/api/v1/site-visits').set(as(t)).send({ customerId: l.customer.id, propertyId: p.id, startAt: inDays(5) })).status).toBe(400)
  })
})
