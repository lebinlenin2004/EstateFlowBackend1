import request from 'supertest'
import app from '../src/app.js'
import { outbox } from '../src/utils/mailer.js'

export const strongPassword = 'Str0ngPass!'
export const cookieOf = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('ef_refresh='))?.split(';')[0]

export async function registerOrg(n = 1, extra = {}) {
  const body = { organizationName: `Org ${n}`, name: `Owner ${n}`, email: `owner${n}@org${n}.test`, password: strongPassword, ...extra }
  const res = await request(app).post('/api/v1/auth/register').send(body)
  return { res, body, token: res.body.data?.accessToken, cookie: cookieOf(res), orgId: res.body.data?.organization?.id }
}

// Invites a member as the owner, accepts through the emailed token, and returns that member's session.
export async function addMember(owner, role, email) {
  outbox.length = 0
  await request(app).post('/api/v1/organizations/invitations').set('Authorization', `Bearer ${owner.token}`).send({ email, role }).expect(201)
  const token = outbox.at(-1).text.match(/token=([\w-]+)/)[1]
  const res = await request(app).post('/api/v1/auth/accept-invitation').send({ token, name: 'Team Member', password: strongPassword })
  return { res, token: res.body.data?.accessToken, cookie: cookieOf(res) }
}
export { app, request, outbox }
