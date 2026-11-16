import jwt from 'jsonwebtoken'
import { config } from '../config/environment.js'

const OPTS = { issuer: 'estateflow', algorithm: 'HS256' }
export const signAccessToken = (claims) => jwt.sign(claims, config.JWT_ACCESS_SECRET, { ...OPTS, expiresIn: config.JWT_ACCESS_TTL })
export const verifyAccessToken = (token) => jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: OPTS.issuer, algorithms: [OPTS.algorithm] })
