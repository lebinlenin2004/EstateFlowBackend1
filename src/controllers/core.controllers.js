import { asyncHandler as h } from '../utils/asyncHandler.js'
import { sendSuccess as ok, sendCreated } from '../utils/apiResponse.js'
import * as props from '../services/property.service.js'
import * as owners from '../services/owner.service.js'
import * as customers from '../services/customer.service.js'

const page = (res, { items, meta }) => ok(res, { data: items, meta })
export const property = {
  create: h(async (req, res) => sendCreated(res, await props.createProperty(req.auth, req.body), 'Property created')),
  list: h(async (req, res) => page(res, await props.listProperties(req.auth, req.query))),
  summary: h(async (req, res) => ok(res, { data: await props.propertySummary(req.auth) })),
  get: h(async (req, res) => ok(res, { data: await props.getProperty(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await props.updateProperty(req.auth, req.params.id, req.body), message: 'Property updated' })),
  status: h(async (req, res) => ok(res, { data: await props.changeStatus(req.auth, req.params.id, req.body), message: 'Status updated' })),
  assign: h(async (req, res) => ok(res, { data: await props.assignAgent(req.auth, req.params.id, req.body.agentId), message: 'Agent updated' })),
  archive: h(async (req, res) => { await props.archiveProperty(req.auth, req.params.id); ok(res, { message: 'Property archived' }) }),
  restore: h(async (req, res) => ok(res, { data: await props.restoreProperty(req.auth, req.params.id), message: 'Property restored' })),
  history: h(async (req, res) => page(res, await props.propertyHistory(req.auth, req.params.id, req.query))),
  interest: h(async (req, res) => ok(res, { data: await props.propertyInterest(req.auth, req.params.id) })),
  addImages: h(async (req, res) => sendCreated(res, await props.addImages(req.auth, req.params.id, req.files), 'Images uploaded')),
  removeImage: h(async (req, res) => ok(res, { data: await props.removeImage(req.auth, req.params.id, req.params.imageId), message: 'Image removed' })),
  cover: h(async (req, res) => ok(res, { data: await props.setCover(req.auth, req.params.id, req.params.imageId), message: 'Cover image updated' })),
}
export const owner = {
  create: h(async (req, res) => sendCreated(res, await owners.createOwner(req.auth, req.body), 'Owner created')),
  list: h(async (req, res) => page(res, await owners.listOwners(req.auth, req.query))),
  get: h(async (req, res) => ok(res, { data: await owners.getOwner(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await owners.updateOwner(req.auth, req.params.id, req.body), message: 'Owner updated' })),
  archive: h(async (req, res) => { await owners.archiveOwner(req.auth, req.params.id); ok(res, { message: 'Owner archived' }) }),
}
export const customer = {
  create: h(async (req, res) => sendCreated(res, await customers.createCustomer(req.auth, req.body), 'Customer created')),
  list: h(async (req, res) => page(res, await customers.listCustomers(req.auth, req.query))),
  get: h(async (req, res) => ok(res, { data: await customers.getCustomer(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await customers.updateCustomer(req.auth, req.params.id, req.body), message: 'Customer updated' })),
  archive: h(async (req, res) => { await customers.archiveCustomer(req.auth, req.params.id); ok(res, { message: 'Customer archived' }) }),
  restore: h(async (req, res) => ok(res, { data: await customers.restoreCustomer(req.auth, req.params.id), message: 'Customer restored' })),
  history: h(async (req, res) => ok(res, { data: await customers.customerHistory(req.auth, req.params.id) })),
}
