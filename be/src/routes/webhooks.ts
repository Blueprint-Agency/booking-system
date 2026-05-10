import { Router } from 'express'
import express from 'express'
import { Webhook } from 'svix'
import { db } from '../db'
import { users, clients } from '../db/schema/users'
import { clerkClient } from '../lib/clerk'
import { eq } from 'drizzle-orm'

const router = Router()

router.post('/webhooks/clerk', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET!
  const wh = new Webhook(secret)

  let event: any
  try {
    event = wh.verify(req.body, {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    })
  } catch {
    res.status(400).json({ error: 'Invalid webhook signature' })
    return
  }

  const data = event.data

  if (event.type === 'user.created') {
    const email = data.email_addresses?.[0]?.email_address
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || email
    const role = data.public_metadata?.role ?? 'client'

    await db.insert(users).values({
      id: data.id,
      email,
      name,
      role,
    })

    // Set role on Clerk if not already set
    if (!data.public_metadata?.role) {
      await clerkClient.users.updateUserMetadata(data.id, {
        publicMetadata: { role: 'client' },
      })
    }

    // Create client row for client role
    if (role === 'client') {
      const referralCode = `YS-${data.id.slice(-6).toUpperCase()}`
      await db.insert(clients).values({ userId: data.id, referralCode })
    }
  }

  if (event.type === 'user.updated') {
    await db
      .update(users)
      .set({
        email: data.email_addresses?.[0]?.email_address,
        name: [data.first_name, data.last_name].filter(Boolean).join(' '),
        updatedAt: new Date(),
      })
      .where(eq(users.id, data.id))
  }

  res.json({ received: true })
})

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  // Implemented when PaymentService is built
  res.json({ received: true })
})

export default router
