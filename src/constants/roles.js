export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin', OWNER: 'owner', BRANCH_MANAGER: 'branch_manager',
  PROPERTY_MANAGER: 'property_manager', SALES_AGENT: 'sales_agent', ACCOUNTANT: 'accountant',
})
export const TENANT_ROLES = Object.values(ROLES).filter((r) => r !== ROLES.SUPER_ADMIN)
// Which roles each role may invite
export const INVITABLE_ROLES = Object.freeze({
  [ROLES.OWNER]: TENANT_ROLES,
  [ROLES.BRANCH_MANAGER]: [ROLES.PROPERTY_MANAGER, ROLES.SALES_AGENT, ROLES.ACCOUNTANT],
})
