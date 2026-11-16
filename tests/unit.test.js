import mongoose from 'mongoose'
import { request, app } from './helpers.js'
import { hasPermission, ROLE_PERMISSIONS } from '../src/constants/permissions.js'
import { ROLES } from '../src/constants/roles.js'
import { signAccessToken, verifyAccessToken } from '../src/utils/tokens.js'
import { sha256, randomToken } from '../src/utils/crypto.js'
import { tenantScope } from '../src/models/plugins/tenantScope.js'
import { runWithTenant } from '../src/utils/tenantContext.js'

describe('permissions', () => {
  it('gives owners everything except platform management', () => {
    expect(hasPermission(ROLES.OWNER, 'subscription:manage')).toBe(true)
    expect(hasPermission(ROLES.OWNER, 'platform:manage')).toBe(false)
  })
  it('keeps sales agents away from finance and invitations', () => {
    expect(hasPermission(ROLES.SALES_AGENT, 'lead:write')).toBe(true)
    for (const p of ['commission:manage', 'member:invite', 'property:delete', 'report:financial']) expect(hasPermission(ROLES.SALES_AGENT, p)).toBe(false)
  })
  it('limits accountants to financial work', () => {
    expect(hasPermission(ROLES.ACCOUNTANT, 'rentpayment:manage')).toBe(true)
    expect(hasPermission(ROLES.ACCOUNTANT, 'lead:write')).toBe(false)
  })
  it('limits super admin to platform scope', () => expect(ROLE_PERMISSIONS[ROLES.SUPER_ADMIN]).toEqual(['platform:manage']))
})

describe('tokens and hashing', () => {
  it('round-trips access tokens and rejects tampering', () => {
    const t = signAccessToken({ sub: 'u1', org: 'o1', mid: 'm1', role: 'owner' })
    expect(verifyAccessToken(t)).toMatchObject({ sub: 'u1', org: 'o1', iss: 'estateflow' })
    expect(() => verifyAccessToken(t.slice(0, -2) + 'xx')).toThrow()
  })
  it('hashes deterministically and generates unique tokens', () => {
    expect(sha256('a')).toBe(sha256('a'))
    expect(randomToken()).not.toBe(randomToken())
  })
})

describe('tenantScope plugin fails closed', () => {
  const Widget = mongoose.model('UnitWidget', new mongoose.Schema({ name: String }).plugin(tenantScope))
  const orgA = new mongoose.Types.ObjectId().toString()
  const orgB = new mongoose.Types.ObjectId().toString()
  it('refuses queries with no tenant context', async () => {
    await expect(Widget.find()).rejects.toThrow(/Tenant context missing/)
    await expect(Widget.findById(orgA)).rejects.toThrow(/Tenant context missing/)
    await expect(Widget.deleteMany({})).rejects.toThrow(/Tenant context missing/)
    await expect(Widget.aggregate([{ $match: {} }])).rejects.toThrow(/Tenant context missing/)
  })
  it('refuses writes with no tenant context', async () => {
    await expect(new Widget({ name: 'x' }).save()).rejects.toThrow(/Tenant context missing/)
  })
  it('blocks writing a document for another organization', async () => {
    await expect(runWithTenant({ orgId: orgA }, () => new Widget({ name: 'x', organization: orgB }).save())).rejects.toThrow(/Cross-tenant write blocked/)
  })
})

describe('request validation and auth wall (no database needed)', () => {
  it('rejects weak registration passwords with field errors', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ organizationName: 'A', name: 'B', email: 'nope', password: 'weak' })
    expect(res.status).toBe(400)
    expect(res.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['body.organizationName', 'body.email', 'body.password']))
  })
  it('ignores an organization id supplied by the client on register', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'x', organizationId: 'not-an-id' })
    expect(res.status).toBe(400)
  })
  it.each([['get', '/api/v1/auth/me'], ['get', '/api/v1/organizations/members'], ['post', '/api/v1/organizations/invitations'], ['post', '/api/v1/auth/change-password']])(
    '%s %s requires authentication', async (method, url) => {
      expect((await request(app)[method](url)).status).toBe(401)
    })
  it('rejects forged tokens', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc.def.ghi')
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ success: false })
  })
})

describe('tenantScope stamping', () => {
  const Stamp = mongoose.model('UnitStamp', new mongoose.Schema({ name: String }).plugin(tenantScope))
  const org = new mongoose.Types.ObjectId().toString()
  it('sets the organization from context before validation', async () => {
    const doc = new Stamp({ name: 'x' })
    await runWithTenant({ orgId: org }, () => doc.validate())
    expect(String(doc.organization)).toBe(org)
  })
})
