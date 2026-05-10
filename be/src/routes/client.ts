import { Router } from 'express'
import { verifyAuth } from '../middleware/auth'
import { requireRole } from '../middleware/require-role'

const router = Router()

router.use(verifyAuth, requireRole('client'))

router.get('/me', async (req, res) => {})
router.patch('/me', async (req, res) => {})

router.get('/me/bookings', async (req, res) => {})
router.post('/me/bookings/class', async (req, res) => {})
router.post('/me/bookings/workshop', async (req, res) => {})
router.delete('/me/bookings/:id', async (req, res) => {})
router.get('/me/bookings/:id/qr', async (req, res) => {})

router.post('/me/packages/purchase', async (req, res) => {})
router.get('/me/packages', async (req, res) => {})

router.get('/me/invoices', async (req, res) => {})

router.post('/me/refund-requests', async (req, res) => {})
router.post('/me/cancellation-requests', async (req, res) => {})

router.get('/me/waiver', async (req, res) => {})
router.post('/me/waiver/sign', async (req, res) => {})

router.get('/me/private-requests', async (req, res) => {})
router.post('/me/private-requests', async (req, res) => {})

router.get('/me/referral', async (req, res) => {})

router.post('/ratings/:bookingId', async (req, res) => {})

export default router
