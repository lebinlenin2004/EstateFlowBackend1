import { request, app } from './helpers.js'
import { toMinor, fromMinor, hasAtMostTwoDecimals } from '../src/utils/money.js'
import { normalizePhone, isValidPhone } from '../src/utils/phone.js'
import { createPropertySchema, updatePropertySchema, listPropertiesSchema, statusSchema } from '../src/validators/property.validators.js'
import { createCustomerSchema } from '../src/validators/customer.validators.js'

describe('money', () => {
  it('converts to integer paise without float drift', () => {
    expect(toMinor(7999999.99)).toBe(799999999)
    expect(toMinor(0.29)).toBe(29)
    expect(fromMinor(799999999)).toBe(7999999.99)
    expect(Number.isInteger(toMinor(1234.56))).toBe(true)
  })
  it('rejects more than two decimals', () => {
    expect(hasAtMostTwoDecimals(10.25)).toBe(true)
    expect(hasAtMostTwoDecimals(10.255)).toBe(false)
  })
})

describe('phone', () => {
  it('normalizes formatting and validates digit counts', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210')
    expect(isValidPhone('+919876543210')).toBe(true)
    expect(isValidPhone('12345')).toBe(false)
    expect(isValidPhone('98a76543210')).toBe(false)
  })
})

const base = { title: 'Skyline Heights 3BHK', propertyType: 'apartment', listingType: 'sale', address: { city: 'Kozhikode' }, price: 7500000 }
describe('property validators', () => {
  it('accepts a minimal valid property and applies cleanup', () => {
    const r = createPropertySchema.body.parse({ ...base, amenities: ['Gym', 'gym ', 'Parking'] })
    expect(r.amenities).toEqual(['gym', 'parking'])
  })
  it('requires title, type, listing, city and price', () => {
    for (const k of ['title', 'propertyType', 'listingType', 'address', 'price']) {
      const { [k]: _omit, ...rest } = base
      expect(createPropertySchema.body.safeParse(rest).success).toBe(false)
    }
    expect(createPropertySchema.body.safeParse({ ...base, address: {} }).success).toBe(false)
  })
  it('rejects bad values and fields the client must not control', () => {
    const p = (o) => createPropertySchema.body.safeParse({ ...base, ...o }).success
    expect(p({ propertyType: 'castle' })).toBe(false)
    expect(p({ price: -5 })).toBe(false)
    expect(p({ price: 100.123 })).toBe(false)
    expect(p({ latitude: 11.25 })).toBe(false) // needs longitude too
    expect(p({ latitude: 11.25, longitude: 75.78 })).toBe(true)
    expect(p({ organization: 'abc' })).toBe(false)
    expect(p({ status: 'sold' })).toBe(false)
    expect(p({ code: 'PR-9999' })).toBe(false)
  })
  it('update allows partial and nullable owner but nothing empty', () => {
    expect(updatePropertySchema.body.safeParse({ ownerId: null }).success).toBe(true)
    expect(updatePropertySchema.body.safeParse({}).success).toBe(false)
    expect(updatePropertySchema.body.safeParse({ status: 'sold' }).success).toBe(false)
  })
  it('list query: coerces filters, splits amenities, validates geo and price ranges', () => {
    const q = listPropertiesSchema.query.parse({ minPrice: '1000000', bedrooms: '3', amenities: 'Gym, Parking', archived: 'false' })
    expect(q).toMatchObject({ minPrice: 1000000, bedrooms: 3, amenities: ['gym', 'parking'], archived: false, sort: 'newest', limit: 20 })
    expect(listPropertiesSchema.query.safeParse({ lat: '11', lng: '75' }).success).toBe(false)
    expect(listPropertiesSchema.query.safeParse({ minPrice: '9', maxPrice: '5' }).success).toBe(false)
    expect(listPropertiesSchema.query.safeParse({ sort: 'random' }).success).toBe(false)
  })
  it('status limited to the known set', () => {
    expect(statusSchema.body.safeParse({ status: 'sold' }).success).toBe(true)
    expect(statusSchema.body.safeParse({ status: 'deleted' }).success).toBe(false)
  })
})

describe('customer validators', () => {
  it('normalizes phones and checks budget order', () => {
    const r = createCustomerSchema.body.parse({ name: 'Arun Nair', phone: '+91 98765 43210', budget: { min: 5000000, max: 8000000 } })
    expect(r.phone).toBe('+919876543210')
    expect(createCustomerSchema.body.safeParse({ name: 'A B', phone: '9876543210', budget: { min: 9, max: 5 } }).success).toBe(false)
    expect(createCustomerSchema.body.safeParse({ name: 'A B', phone: '123' }).success).toBe(false)
    expect(createCustomerSchema.body.safeParse({ name: 'A B', phone: '9876543210', customerType: 'alien' }).success).toBe(false)
  })
})

describe('new routes require authentication', () => {
  it.each([['get', '/api/v1/properties'], ['post', '/api/v1/properties'], ['get', '/api/v1/properties/summary'], ['post', '/api/v1/properties/abc/images'],
    ['get', '/api/v1/owners'], ['get', '/api/v1/customers'], ['post', '/api/v1/customers'], ['delete', '/api/v1/customers/abc']])(
    '%s %s -> 401', async (m, u) => { expect((await request(app)[m](u)).status).toBe(401) })
})
