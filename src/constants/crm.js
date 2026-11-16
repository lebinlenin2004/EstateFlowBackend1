import { LISTING_TYPES } from './property.js'
export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'site_visit_scheduled', 'negotiation', 'converted', 'lost']
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'interested', 'site_visit_scheduled', 'negotiation']
export const QUALIFIED_LEAD_STATUSES = ['interested', 'site_visit_scheduled', 'negotiation']
export const LEAD_PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const LEAD_SOURCES = ['website', 'whatsapp', 'phone', 'referral', 'social_media', 'advertisement', 'walk_in']
export const MANUAL_ACTIVITY_TYPES = ['call_completed', 'email_sent', 'whatsapp_message', 'meeting_held', 'note_added']
export const SYSTEM_ACTIVITY_TYPES = ['lead_created', 'lead_updated', 'status_changed', 'priority_changed', 'agent_assigned', 'site_visit_scheduled', 'site_visit_completed',
  'site_visit_cancelled', 'follow_up_scheduled', 'follow_up_completed', 'converted', 'archived', 'restored']
export const ACTIVITY_TYPES = [...MANUAL_ACTIVITY_TYPES, ...SYSTEM_ACTIVITY_TYPES]
// Activities that count as contact with the customer (they refresh "last interaction")
export const INTERACTION_TYPES = [...MANUAL_ACTIVITY_TYPES, 'site_visit_completed', 'follow_up_completed', 'status_changed']
export const FOLLOWUP_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'other']
export const FOLLOWUP_STATUSES = ['pending', 'completed', 'cancelled']
export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show']
export const DEAL_TYPES = LISTING_TYPES
