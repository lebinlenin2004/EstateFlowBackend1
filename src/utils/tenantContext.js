import { AsyncLocalStorage } from 'node:async_hooks'
const store = new AsyncLocalStorage()
export const runWithTenant = (ctx, fn) => store.run(ctx, fn)
export const getTenantId = () => store.getStore()?.orgId ?? null
