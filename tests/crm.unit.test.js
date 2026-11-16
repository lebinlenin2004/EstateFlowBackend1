import { request, app } from './helpers.js'
import { dayBounds } from '../src/utils/dates.js'
import { pinAgent, castAgentFilter } from '../src/services/scope.service.js'
import { ROLE_PERMISSIONS } from '../src/constants/permissions.js'
import * as v from '../src/validators/crm.validators.js'

const id = () => '64b7f0c2a1b2c3d4e5f60718'
const id2 = '64b7f0c2a1b2c3d4e5f60719'

describe('dayBounds', () => {
  it('finds the organization-local calendar day as real instants', () => {
    const { start, end } = dayBounds('Asia/Kolkata', new Date('2026-11-15T20:00:00Z')) // 01:30 on 16 Nov in India
    expect(start.toISOString()).toBe('2026-11-15T18:30:00.000Z')
    expect(end.toISOString()).toBe('2026-11-16T18:29:59.999Z')
  })
  it('gives a different day for a different timezone', () => {
    expect(dayBounds('America/New_York', new Date('2026-11-15T20:00:00Z')).start.toISOString()).toBe('2026-11-15T05:00:00.000Z')
  })
})

describe('agent scope helpers', () => {
  it('pins an unscoped filter to the requested agent', () => expect(pinAgent({}, 'a1').assignedAgent).toBe('a1'))
  it('never widens a branch scope', () => {
    expect(pinAgent({ assignedAgent: { $in: ['a1', 'a2'] } }, 'a2').assignedAgent).toBe('a2')
    expect(pinAgent({ assignedAgent: { $in: ['a1', 'a2'] } }, 'zz').assignedAgent).toEqual({ $in: [] })
  })
  it('ignores the request when an agent is already pinned to themselves', () => expect(pinAgent({ assignedAgent: 'me' }, 'other').assignedAgent).toBe('me'))
  it('casts agent ids for aggregations', () => {
    expect(castAgentFilter({ assignedAgent: id() }).assignedAgent.constructor.name).toBe('ObjectId')
    expect(castAgentFilter({ assignedAgent: { $in: [id(), id2] } }).assignedAgent.$in).toHaveLength(2)
  })
})

describe('lead validators', () => {
  const create = (o) => v.createLeadSchema.body.safeParse(o)
  it('needs exactly one of customerId or contact', () => {
    expect(create({ customerId: id() }).success).toBe(true)
    expect(create({ contact: { name: 'Arun Nair', phone: '98765 43210' } }).success).toBe(true)
    expect(create({}).success).toBe(false)
    expect(create({ customerId: id(), contact: { name: 'Arun Nair', phone: '9876543210' } }).success).toBe(false)
  })
  it('normalizes the contact phone and rejects fields the client must not control', () => {
    expect(create({ contact: { name: 'Arun Nair', phone: '+91 98765-43210' } }).data.contact.phone).toBe('+919876543210')
    for (const bad of [{ status: 'converted' }, { organization: id() }, { code: 'LD-1' }, { source: 'carrier_pigeon' }, { priority: 'asap' }])
      expect(create({ customerId: id(), ...bad }).success).toBe(false)
  })
  it('status: converted is blocked and lost needs a reason', () => {
    const s = v.leadStatusSchema.body
    expect(s.safeParse({ status: 'converted' }).success).toBe(false)
    expect(s.safeParse({ status: 'lost' }).success).toBe(false)
    expect(s.safeParse({ status: 'lost', lostReason: 'Bought elsewhere' }).success).toBe(true)
    expect(s.safeParse({ status: 'negotiation' }).success).toBe(true)
  })
  it('convert needs a property or a deal type and a sane value', () => {
    const c = v.convertSchema.body
    expect(c.safeParse({ dealValue: 7500000 }).success).toBe(false)
    expect(c.safeParse({ dealValue: 7500000, dealType: 'sale' }).success).toBe(true)
    expect(c.safeParse({ dealValue: 7500000, propertyId: id() }).success).toBe(true)
    expect(c.safeParse({ dealValue: -1, dealType: 'sale' }).success).toBe(false)
    expect(c.safeParse({ dealValue: 10.999, dealType: 'sale' }).success).toBe(false)
  })
  it('list query: splits status lists, validates values, limits sort', () => {
    const q = v.listLeadsSchema.query
    expect(q.parse({ status: 'new,contacted' }).status).toEqual(['new', 'contacted'])
    expect(q.safeParse({ status: 'new,flying' }).success).toBe(false)
    expect(q.safeParse({ sort: 'random' }).success).toBe(false)
    expect(q.parse({}).unassigned).toBe(false)
  })
})

describe('follow-up and visit validators', () => {
  const future = '2026-11-20T10:00:00+05:30'
  it('requires ISO times with a timezone', () => {
    expect(v.createFollowUpSchema.body.safeParse({ leadId: id(), dueAt: future }).success).toBe(true)
    expect(v.createFollowUpSchema.body.safeParse({ leadId: id(), dueAt: '2026-11-20T10:00' }).success).toBe(false)
    expect(v.createFollowUpSchema.body.safeParse({ leadId: id(), dueAt: 'tomorrow' }).success).toBe(false)
    expect(v.createFollowUpSchema.body.parse({ leadId: id(), dueAt: future }).dueAt).toBeInstanceOf(Date)
  })
  it('visits need a lead or customer and a sensible end time', () => {
    const s = v.createVisitSchema.body
    expect(s.safeParse({ propertyId: id(), startAt: future }).success).toBe(false)
    expect(s.safeParse({ leadId: id(), propertyId: id2, startAt: future }).success).toBe(true)
    expect(s.safeParse({ leadId: id(), propertyId: id2, startAt: future, endAt: '2026-11-20T09:00:00+05:30' }).success).toBe(false)
    expect(s.safeParse({ leadId: id(), propertyId: id2, startAt: future, endAt: '2026-11-20T20:00:00+05:30' }).success).toBe(false)
  })
  it('calendar ranges are capped at 62 days', () => {
    const c = v.calendarSchema.query
    expect(c.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success).toBe(true)
    expect(c.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(false)
    expect(c.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success).toBe(false)
  })
  it('feedback needs at least one field and a 1-5 rating', () => {
    const f = v.visitFeedbackSchema.body
    expect(f.safeParse({}).success).toBe(false)
    expect(f.safeParse({ rating: 6 }).success).toBe(false)
    expect(f.safeParse({ rating: 4, interested: true }).success).toBe(true)
  })
})

describe('permissions for CRM roles', () => {
  it('keeps CRM away from accountants and property managers, and assignment away from agents', () => {
    expect(ROLE_PERMISSIONS.accountant).not.toContain('lead:read')
    expect(ROLE_PERMISSIONS.property_manager).not.toContain('visit:manage')
    expect(ROLE_PERMISSIONS.sales_agent).toContain('lead:write')
    expect(ROLE_PERMISSIONS.sales_agent).not.toContain('lead:assign')
    expect(ROLE_PERMISSIONS.branch_manager).toContain('lead:assign')
  })
})

describe('CRM routes require authentication', () => {
  it.each([['get', '/api/v1/leads'], ['post', '/api/v1/leads'], ['get', '/api/v1/leads/pipeline'], ['post', '/api/v1/leads/abc/convert'], ['get', '/api/v1/followups'],
    ['get', '/api/v1/followups/summary'], ['get', '/api/v1/site-visits'], ['get', '/api/v1/site-visits/calendar'], ['patch', '/api/v1/site-visits/abc/cancel'],
    ['get', '/api/v1/customers/abc/history'], ['get', '/api/v1/properties/abc/interest']])('%s %s -> 401', async (m, u) => { expect((await request(app)[m](u)).status).toBe(401) })
})
