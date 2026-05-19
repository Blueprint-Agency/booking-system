import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const client = postgres(process.env.DATABASE_URL!)
const db = drizzle(client, { schema })

const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

async function seed() {
  console.log('Seeding locations...')
  await db.insert(schema.locations).values([
    {
      name: 'Breadtalk IHQ (Tai Seng)',
      address: '30 Tai Seng Street, #09-01 Breadtalk IHQ, Singapore 534013',
      gmapsUrl: 'https://maps.google.com/?q=Breadtalk+IHQ+Tai+Seng',
      phone: null,
    },
    {
      name: 'Outram Park',
      address: '1 Cantonment Road, #09-01, Singapore 085101',
      gmapsUrl: 'https://maps.google.com/?q=Outram+Park+Singapore',
      phone: null,
    },
  ]).onConflictDoNothing()

  console.log('Seeding class types...')
  await db.insert(schema.classTypes).values([
    { name: 'Hatha' },
    { name: 'Vinyasa' },
    { name: 'Yin' },
    { name: 'Restorative' },
    { name: 'Aerial Yoga' },
    { name: 'Pilates' },
  ]).onConflictDoNothing()

  console.log('Seeding class packages...')
  await db.insert(schema.classPackages).values([
    // Credit bundles
    {
      name: 'One-time Pass',
      kind: 'credit_bundle',
      credits: 1,
      validityDays: 1,
      priceSgd: '40.00',
    },
    {
      name: 'Bundle of 10',
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '300.00',
    },
    {
      name: 'Bundle of 20',
      kind: 'credit_bundle',
      credits: 20,
      validityDays: 180,
      priceSgd: '550.00',
    },
    {
      name: 'Bundle of 30',
      kind: 'credit_bundle',
      credits: 30,
      validityDays: 365,
      priceSgd: '750.00',
    },
    {
      name: 'Bundle of 50',
      kind: 'credit_bundle',
      credits: 50,
      validityDays: 365,
      priceSgd: '1100.00',
    },
    {
      name: 'Bundle of 100',
      kind: 'credit_bundle',
      credits: 100,
      validityDays: 365,
      priceSgd: '2000.00',
    },
    // Unlimited passes
    {
      name: '3-Month Unlimited',
      kind: 'unlimited',
      durationDays: 90,
      priceSgd: '600.00',
    },
    {
      name: '6-Month Unlimited',
      kind: 'unlimited',
      durationDays: 180,
      priceSgd: '1000.00',
    },
    {
      name: '12-Month Unlimited',
      kind: 'unlimited',
      durationDays: 365,
      priceSgd: '1700.00',
    },
  ]).onConflictDoNothing()

  console.log('Seeding PT packages...')
  await db.insert(schema.ptPackages).values([
    // 1-on-1
    { name: 'VIP 10 Sessions 1-on-1', sessionType: '1on1', numSessions: 10,  priceSgd: '1600.00' },
    { name: 'VIP 20 Sessions 1-on-1', sessionType: '1on1', numSessions: 20,  priceSgd: '3000.00' },
    { name: 'VIP 30 Sessions 1-on-1', sessionType: '1on1', numSessions: 30,  priceSgd: '4200.00' },
    { name: 'VIP 40 Sessions 1-on-1', sessionType: '1on1', numSessions: 40,  priceSgd: '5200.00' },
    { name: 'VIP 50 Sessions 1-on-1', sessionType: '1on1', numSessions: 50,  priceSgd: '6000.00' },
    { name: 'VIP 100 Sessions 1-on-1', sessionType: '1on1', numSessions: 100, priceSgd: '11000.00' },
    // 2-on-1
    { name: 'VIP 10 Sessions 2-on-1', sessionType: '2on1', numSessions: 10, priceSgd: '2000.00' },
    { name: 'VIP 20 Sessions 2-on-1', sessionType: '2on1', numSessions: 20, priceSgd: '3600.00' },
    { name: 'VIP 30 Sessions 2-on-1', sessionType: '2on1', numSessions: 30, priceSgd: '4800.00' },
    { name: 'VIP 50 Sessions 2-on-1', sessionType: '2on1', numSessions: 50, priceSgd: '7500.00' },
  ]).onConflictDoNothing()

  console.log('Seeding global policy...')
  await db.insert(schema.globalPolicy).values({
    id: POLICY_SINGLETON_ID,
    cancelCapCount: 3,
    cancelCapCycleDays: 30,
    classWindowHours: 2,
    ptWindowHours: 24,
  }).onConflictDoNothing()

  console.log('Seeding PT booking config...')
  await db.insert(schema.ptBookingConfig).values({
    id: PT_CONFIG_SINGLETON_ID,
    bookInAdvanceDays: 7,
  }).onConflictDoNothing()

  console.log('Done.')
  await client.end()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
