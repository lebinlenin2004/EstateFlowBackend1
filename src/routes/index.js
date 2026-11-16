import { Router } from 'express'
import healthRoutes from './health.routes.js'
import authRoutes from './auth.routes.js'
import organizationRoutes from './organization.routes.js'
import branchRoutes from './branch.routes.js'
import employeeRoutes from './employee.routes.js'
import propertyRoutes from './property.routes.js'
import ownerRoutes from './owner.routes.js'
import customerRoutes from './customer.routes.js'
import leadRoutes from './lead.routes.js'
import followUpRoutes from './followup.routes.js'
import siteVisitRoutes from './sitevisit.routes.js'
const router = Router()
router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/organizations', organizationRoutes)
router.use('/branches', branchRoutes)
router.use('/employees', employeeRoutes)
router.use('/properties', propertyRoutes)
router.use('/owners', ownerRoutes)
router.use('/customers', customerRoutes)
router.use('/leads', leadRoutes)
router.use('/followups', followUpRoutes)
router.use('/site-visits', siteVisitRoutes)
// Next: rentals, agreements, commissions, notifications ...
export default router
