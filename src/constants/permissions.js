import { ROLES } from './roles.js'

export const PERMISSIONS = Object.freeze([
  'org:read', 'org:update', 'branch:read', 'branch:manage', 'member:read', 'member:invite', 'member:manage',
  'property:read', 'property:write', 'property:delete', 'owner:manage', 'customer:read', 'customer:write',
  'lead:read', 'lead:write', 'lead:assign', 'followup:manage', 'visit:manage',
  'rental:manage', 'rentpayment:manage', 'agreement:manage', 'commission:read', 'commission:manage',
  'report:org', 'report:branch', 'report:financial', 'subscription:manage', 'platform:manage',
])

const crm = ['customer:read', 'customer:write', 'lead:read', 'lead:write', 'followup:manage', 'visit:manage']

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: ['platform:manage'],
  [ROLES.OWNER]: PERMISSIONS.filter((p) => p !== 'platform:manage'),
  [ROLES.BRANCH_MANAGER]: ['org:read', 'branch:read', 'member:read', 'member:invite', 'member:manage', 'property:read', 'property:write',
    ...crm, 'lead:assign', 'report:branch'],
  [ROLES.PROPERTY_MANAGER]: ['org:read', 'branch:read', 'property:read', 'property:write', 'owner:manage', 'customer:read',
    'rental:manage', 'agreement:manage'],
  [ROLES.SALES_AGENT]: ['org:read', 'property:read', ...crm],
  [ROLES.ACCOUNTANT]: ['org:read', 'rental:manage', 'rentpayment:manage', 'commission:read', 'commission:manage', 'report:financial'],
})

export const hasPermission = (role, permission) => !!ROLE_PERMISSIONS[role]?.includes(permission)
