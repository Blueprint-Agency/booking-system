import { Router } from 'express'
import { verifyAuth } from '../middleware/auth'
import { requireRole } from '../middleware/require-role'

const router = Router()

router.use(verifyAuth, requireRole('instructor'))

router.get('/instructor/today', async (req, res) => {})
router.get('/instructor/schedule', async (req, res) => {})
router.get('/instructor/classes/:id/roster', async (req, res) => {})
router.post('/instructor/classes/:id/checkin', async (req, res) => {})

router.get('/instructor/private-requests', async (req, res) => {})
router.patch('/instructor/private-requests/:id', async (req, res) => {})

router.get('/instructor/availability', async (req, res) => {})
router.put('/instructor/availability', async (req, res) => {})

router.get('/instructor/profile', async (req, res) => {})
router.patch('/instructor/profile', async (req, res) => {})

router.get('/instructor/teaching-log', async (req, res) => {})
router.get('/instructor/ratings', async (req, res) => {})

export default router
