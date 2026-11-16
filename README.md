# EstateFlow Backend

Multi-tenant real estate SaaS API: Node.js, Express, MongoDB (Mongoose), JWT.
Status: **Phases 1-4 complete** (foundation, auth, core modules, CRM). Operations (rentals, agreements, commissions, notifications) are next.
See `docs/AUTHENTICATION.md` for the security design.

## Quick start
```bash
npm install
copy .env.example .env      # Windows PowerShell. On macOS/Linux: cp .env.example .env
npm run dev
```
Check it works: `http://localhost:8000/api/v1/health`. API docs: `http://localhost:8000/api/docs` (not served in production).

Generate secrets for `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## MongoDB setup
Transactions (lead conversion, commissions) require a **replica set**, even in development.

**Option A: Docker (local)**
```bash
docker compose up -d
```
Use `MONGODB_URI=mongodb://localhost:27017/estateflow?replicaSet=rs0`.

**Option B: MongoDB Atlas (no Docker)**
Create a free cluster, add your IP to the access list, and paste the `mongodb+srv://...` string into `MONGODB_URI`. Atlas clusters are replica sets already.

## Environment variables
See `.env.example`. Values are validated at startup; the server exits with a clear message if any are missing or invalid.

## Architecture
`route -> validator (Zod) -> controller -> service -> model`. Controllers handle HTTP only; services hold business rules.

| Folder | Role |
|---|---|
| `src/config` | Environment, database, storage settings |
| `src/middlewares` | Logging, rate limits, validation, error handling (auth, RBAC and tenant scope arrive in Phase 2) |
| `src/utils` | `ApiError`, `asyncHandler`, response helpers, logger |
| `src/routes`, `controllers`, `services` | API layers |
| `src/docs` | OpenAPI spec |

## Response format
Success: `{ "success": true, "message": "...", "data": {}, "meta": { } }`
Error: `{ "success": false, "message": "...", "errors": [{ "field": "...", "message": "..." }] }`

## Testing
```bash
npm test
```
`tests/unit.test.js` needs no database. `auth.test.js` and `tenant-isolation.test.js` use `mongodb-memory-server`, which downloads a MongoDB binary on first run (needs internet once).

## Auth endpoints (Phase 2)
`POST /auth/register, login, refresh, logout, logout-all, forgot-password, reset-password, change-password, accept-invitation` and `GET/PATCH /auth/me`.
`GET /organizations/members`, `POST /organizations/invitations`.
In development, with no SMTP configured, emails (reset and invitation links) are printed in the server log.

## Organization, branches, employees (Phase 3)
`GET/PATCH /organizations/me`, `POST /organizations/me/logo`, `GET/PATCH /organizations/me/settings`;
`/branches` (CRUD, archive); `/employees` (list, summary, change role or branch, activate or deactivate, remove) and `/employees/invitations`.
Uploaded logos are saved under `UPLOAD_DIR/public` and served at `/uploads/...`. Prefix the API origin when showing them in the frontend.

## Properties, owners, customers (Phase 3)
`/properties` (CRUD, filters, geo radius, status, assign, history, images), `/owners`, `/customers`.
Prices go in and out in rupees; they are stored as integer paise (`priceMinor` is also returned). Images use `STORAGE_DRIVER=local` (default) or `s3` (see `.env.example`; the S3 path is not yet tested against a real bucket).

## CRM (Phase 4)
`/leads` (CRUD, status, priority, assign, convert, activities, pipeline, stats), `/followups`, `/site-visits`, plus `GET /customers/:id/history` and `GET /properties/:id/interest`.
- Every lead has a customer. Creating a lead from contact details finds or creates that customer by phone number.
- Agents see only their own leads, follow-ups, visits and customers; branch managers those of agents in their branch.
- Times are sent as ISO 8601 with an offset (`2026-11-20T10:00:00+05:30`). "Today" for follow-ups uses the organization timezone setting.
- **Lead conversion uses a transaction and needs MongoDB as a replica set** (`docker compose up -d` or Atlas). On a standalone server it answers 503 with a clear message.

## Roadmap
Phase 2 Auth and RBAC, 3 Core modules, 4 CRM, 5 Operations, 6 Dashboards, 7 Billing, 8 AI, 9 Hardening and Docker.
