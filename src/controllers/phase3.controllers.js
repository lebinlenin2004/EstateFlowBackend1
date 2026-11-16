import { asyncHandler as h } from '../utils/asyncHandler.js'
import { sendSuccess as ok, sendCreated } from '../utils/apiResponse.js'
import * as org from '../services/organization.service.js'
import * as branches from '../services/branch.service.js'
import * as emp from '../services/employee.service.js'

export const organization = {
  get: h(async (req, res) => ok(res, { data: await org.getOrganization(req.auth) })),
  update: h(async (req, res) => ok(res, { data: await org.updateOrganization(req.auth, req.body), message: 'Organization updated' })),
  logo: h(async (req, res) => ok(res, { data: await org.uploadLogo(req.auth, req.file), message: 'Logo updated' })),
  getSettings: h(async (req, res) => ok(res, { data: await org.getSettings(req.auth) })),
  updateSettings: h(async (req, res) => ok(res, { data: await org.updateSettings(req.auth, req.body), message: 'Settings saved' })),
}
export const branch = {
  create: h(async (req, res) => sendCreated(res, await branches.createBranch(req.auth, req.body), 'Branch created')),
  list: h(async (req, res) => { const { items, meta } = await branches.listBranches(req.auth, req.query); ok(res, { data: items, meta }) }),
  get: h(async (req, res) => ok(res, { data: await branches.getBranch(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await branches.updateBranch(req.auth, req.params.id, req.body), message: 'Branch updated' })),
  archive: h(async (req, res) => { await branches.archiveBranch(req.auth, req.params.id); ok(res, { message: 'Branch archived' }) }),
}
export const employee = {
  list: h(async (req, res) => { const { items, meta } = await emp.listEmployees(req.auth, req.query); ok(res, { data: items, meta }) }),
  summary: h(async (req, res) => ok(res, { data: await emp.employeeSummary(req.auth) })),
  get: h(async (req, res) => ok(res, { data: await emp.getEmployee(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await emp.updateEmployee(req.auth, req.params.id, req.body), message: 'Employee updated' })),
  status: h(async (req, res) => ok(res, { data: await emp.setEmployeeStatus(req.auth, req.params.id, req.body.status), message: 'Status updated' })),
  remove: h(async (req, res) => { await emp.removeEmployee(req.auth, req.params.id); ok(res, { message: 'Employee removed' }) }),
  invitations: h(async (req, res) => ok(res, { data: await emp.listInvitations(req.auth) })),
  revokeInvitation: h(async (req, res) => { await emp.revokeInvitation(req.auth, req.params.id); ok(res, { message: 'Invitation revoked' }) }),
}
