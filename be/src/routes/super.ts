import { Router } from 'express'
import { verifyAuth } from '../middleware/auth'
import { requireRole } from '../middleware/require-role'

const router = Router()

router.use(verifyAuth, requireRole('super_admin'))

router.get('/super/health', async (req, res) => {})

router.get('/super/feature-flags', async (req, res) => {})
router.patch('/super/feature-flags', async (req, res) => {})
router.get('/super/feature-flags/:key', async (req, res) => {})

router.get('/super/notifications/factory/:event', async (req, res) => {})
router.patch('/super/notifications/factory/:event', async (req, res) => {})

router.post('/super/waiver/bulk-reset', async (req, res) => {})

router.post('/super/impersonate', async (req, res) => {})
router.delete('/super/impersonate', async (req, res) => {})

router.get('/super/studio-admins', async (req, res) => {})
router.post('/super/studio-admins', async (req, res) => {})
router.post('/super/studio-admins/:id/force-logout', async (req, res) => {})

router.get('/super/reports/:type', async (req, res) => {})
router.get('/super/audit-log', async (req, res) => {})

export default router
