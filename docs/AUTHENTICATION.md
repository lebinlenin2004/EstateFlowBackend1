# Authentication, authorization and tenancy

## Model
- **User**: global identity (email, password hash). **Membership**: links a user to an organization with a role. One person can belong to several organizations.
- Platform admins are users with `isPlatformAdmin: true` and no membership; their token has `org: null`, role `super_admin`.

## Tokens
| Token | Lifetime | Where it lives |
|---|---|---|
| Access (JWT, HS256) | 15 min (`JWT_ACCESS_TTL`) | JSON body; the frontend keeps it in memory and sends `Authorization: Bearer` |
| Refresh (opaque, 48 random bytes) | 7 days (`REFRESH_TTL_DAYS`) | httpOnly cookie `ef_refresh`, path `/api/v1/auth`, SameSite=Lax, Secure in production |

Claims: `sub` (user), `org`, `mid` (membership), `role`. The organization is **never** read from a request body, query or header.

Refresh tokens are stored only as SHA-256 hashes. Each refresh atomically consumes the token and issues a new one in the same *family*. Presenting an already-used token revokes the whole family (assumed theft). Two simultaneous refreshes from one browser can trigger this, so the frontend must serialize refresh calls.

Because the cookie is SameSite=Lax, the frontend and API must be same-site (for example `app.example.com` and `api.example.com`). A cross-site deployment needs `SameSite=None; Secure` plus CSRF protection.

## Request pipeline
`authenticate` verifies the JWT, then re-reads the user, membership and organization from the database, so deactivating a user or suspending an organization takes effect on the next request. Tokens issued before a password change are rejected. It then opens the tenant context for the rest of the request.

`authorize('lead:assign')` checks the caller's current role against `src/constants/permissions.js`.

## Tenant isolation
Every organization-owned model uses the `tenantScope` plugin (`src/models/plugins/tenantScope.js`). It:
- adds a required, immutable `organization` field,
- adds `{ organization }` to every find, update, delete and count,
- prepends an organization `$match` to aggregations,
- stamps new documents from the context, and rejects writes naming another organization,
- **throws** if there is no tenant context (it fails closed).

Cross-tenant jobs must opt out explicitly with `.setOptions({ skipTenant: true })`. Auth-layer models (Membership, Invitation, RefreshSession) are filtered explicitly because they are looked up before a tenant is known.

Aggregations using `$geoNear` must be the first stage, so geo searches add the organization filter to `$geoNear.query` themselves.

## Password rules
8-72 characters with a lowercase letter, an uppercase letter and a number. Reset tokens last 1 hour and work once. `forgot-password` answers identically whether or not the account exists. Reset signs out every device; change keeps the current device.
