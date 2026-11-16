import { request, app } from './helpers.js'
import { detectImageType } from '../src/utils/fileSignature.js'
import { escapeRegex } from '../src/utils/escapeRegex.js'
import { updateSettingsSchema, updateOrganizationSchema } from '../src/validators/organization.validators.js'
import { createBranchSchema } from '../src/validators/branch.validators.js'
import { updateEmployeeSchema, listEmployeesSchema } from '../src/validators/employee.validators.js'

describe('image signature detection', () => {
  const pad = (b) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)])
  it('recognises real images by bytes', () => {
    expect(detectImageType(pad([0x89, 0x50, 0x4e, 0x47]))?.ext).toBe('png')
    expect(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg')
    expect(detectImageType(Buffer.from('RIFF....WEBPVP8 ....'))?.ext).toBe('webp')
  })
  it('rejects text, scripts and SVG regardless of name', () => {
    expect(detectImageType(Buffer.from('<script>alert(1)</script> padding'))).toBeNull()
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectImageType(Buffer.from('tiny'))).toBeNull()
  })
})

describe('regex escaping', () => {
  it('neutralises regex metacharacters in search input', () => {
    const rx = new RegExp(escapeRegex('(a+)+$'), 'i')
    expect(rx.test('(a+)+$')).toBe(true)
    expect(rx.test('aaaa')).toBe(false)
  })
})

describe('validators', () => {
  it('settings: accepts partial valid updates and rejects unknown or invalid values', () => {
    const s = updateSettingsSchema.body
    expect(s.safeParse({ timezone: 'Asia/Kolkata', notifications: { email: false } }).success).toBe(true)
    expect(s.safeParse({ timezone: 'Mars/Base' }).success).toBe(false)
    expect(s.safeParse({ currency: 'XXX' }).success).toBe(false)
    expect(s.safeParse({ visitDurationMinutes: 5 }).success).toBe(false)
    expect(s.safeParse({ plan: 'enterprise' }).success).toBe(false) // unknown keys are rejected, not silently kept
    expect(s.safeParse({}).success).toBe(false)
  })
  it('organization: cannot set plan, status or logo directly', () => {
    const s = updateOrganizationSchema.body
    expect(s.safeParse({ plan: 'enterprise' }).success).toBe(false)
    expect(s.safeParse({ status: 'active' }).success).toBe(false)
    expect(s.safeParse({ name: 'Malabar Realty', address: { city: 'Kozhikode' } }).success).toBe(true)
  })
  it('branch: uppercases codes and requires a name', () => {
    const s = createBranchSchema.body
    expect(s.parse({ name: 'Calicut Main', code: 'cal-01' }).code).toBe('CAL-01')
    expect(s.safeParse({ code: 'AB' }).success).toBe(false)
    expect(s.safeParse({ name: 'X', code: '!!' }).success).toBe(false)
  })
  it('employee: cannot assign the super_admin role', () => {
    expect(updateEmployeeSchema.body.safeParse({ role: 'super_admin' }).success).toBe(false)
    expect(updateEmployeeSchema.body.safeParse({ role: 'sales_agent', branchId: null }).success).toBe(true)
    expect(listEmployeesSchema.query.parse({}).limit).toBe(20)
  })
})

describe('new routes sit behind authentication', () => {
  it.each([['get', '/api/v1/organizations/me'], ['patch', '/api/v1/organizations/me/settings'], ['post', '/api/v1/organizations/me/logo'],
    ['get', '/api/v1/branches'], ['post', '/api/v1/branches'], ['get', '/api/v1/employees'], ['patch', '/api/v1/employees/abc/status'], ['delete', '/api/v1/branches/abc']])(
    '%s %s -> 401', async (m, u) => { expect((await request(app)[m](u)).status).toBe(401) })
})
