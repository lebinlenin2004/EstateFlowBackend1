import { asyncHandler as h } from '../utils/asyncHandler.js'
import { sendSuccess as ok, sendCreated } from '../utils/apiResponse.js'
import * as leads from '../services/lead.service.js'
import * as followUps from '../services/followup.service.js'
import * as visits from '../services/sitevisit.service.js'

const page = (res, { items, meta }) => ok(res, { data: items, meta })
export const lead = {
  create: h(async (req, res) => sendCreated(res, await leads.createLead(req.auth, req.body), 'Lead created')),
  list: h(async (req, res) => page(res, await leads.listLeads(req.auth, req.query))),
  pipeline: h(async (req, res) => ok(res, { data: await leads.pipeline(req.auth, req.query) })),
  stats: h(async (req, res) => ok(res, { data: await leads.leadStats(req.auth, req.query) })),
  get: h(async (req, res) => ok(res, { data: await leads.getLead(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await leads.updateLead(req.auth, req.params.id, req.body), message: 'Lead updated' })),
  status: h(async (req, res) => ok(res, { data: await leads.setStatus(req.auth, req.params.id, req.body), message: 'Status updated' })),
  priority: h(async (req, res) => ok(res, { data: await leads.setPriority(req.auth, req.params.id, req.body), message: 'Priority updated' })),
  assign: h(async (req, res) => ok(res, { data: await leads.assignLead(req.auth, req.params.id, req.body), message: 'Lead assigned' })),
  convert: h(async (req, res) => ok(res, { data: await leads.convertLead(req.auth, req.params.id, req.body), message: 'Lead converted' })),
  archive: h(async (req, res) => { await leads.archiveLead(req.auth, req.params.id); ok(res, { message: 'Lead archived' }) }),
  restore: h(async (req, res) => ok(res, { data: await leads.restoreLead(req.auth, req.params.id), message: 'Lead restored' })),
  addActivity: h(async (req, res) => sendCreated(res, await leads.addActivity(req.auth, req.params.id, req.body), 'Activity recorded')),
  activities: h(async (req, res) => page(res, await leads.listActivities(req.auth, req.params.id, req.query))),
}
export const followUp = {
  create: h(async (req, res) => sendCreated(res, await followUps.createFollowUp(req.auth, req.body), 'Follow-up scheduled')),
  list: h(async (req, res) => page(res, await followUps.listFollowUps(req.auth, req.query))),
  summary: h(async (req, res) => ok(res, { data: await followUps.followUpSummary(req.auth, req.query) })),
  get: h(async (req, res) => ok(res, { data: await followUps.getFollowUp(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await followUps.updateFollowUp(req.auth, req.params.id, req.body), message: 'Follow-up updated' })),
  complete: h(async (req, res) => ok(res, { data: await followUps.completeFollowUp(req.auth, req.params.id, req.body), message: 'Follow-up completed' })),
  cancel: h(async (req, res) => ok(res, { data: await followUps.cancelFollowUp(req.auth, req.params.id, req.body), message: 'Follow-up cancelled' })),
}
export const siteVisit = {
  create: h(async (req, res) => sendCreated(res, await visits.createVisit(req.auth, req.body), 'Site visit scheduled')),
  list: h(async (req, res) => page(res, await visits.listVisits(req.auth, req.query))),
  calendar: h(async (req, res) => ok(res, { data: await visits.calendar(req.auth, req.query) })),
  summary: h(async (req, res) => ok(res, { data: await visits.visitSummary(req.auth) })),
  get: h(async (req, res) => ok(res, { data: await visits.getVisit(req.auth, req.params.id) })),
  update: h(async (req, res) => ok(res, { data: await visits.updateVisit(req.auth, req.params.id, req.body), message: 'Site visit updated' })),
  reschedule: h(async (req, res) => ok(res, { data: await visits.reschedule(req.auth, req.params.id, req.body), message: 'Site visit rescheduled' })),
  cancel: h(async (req, res) => ok(res, { data: await visits.cancelVisit(req.auth, req.params.id, req.body), message: 'Site visit cancelled' })),
  complete: h(async (req, res) => ok(res, { data: await visits.completeVisit(req.auth, req.params.id, req.body), message: 'Site visit completed' })),
  noShow: h(async (req, res) => ok(res, { data: await visits.markNoShow(req.auth, req.params.id), message: 'Marked as no-show' })),
  feedback: h(async (req, res) => ok(res, { data: await visits.addFeedback(req.auth, req.params.id, req.body), message: 'Feedback saved' })),
}
