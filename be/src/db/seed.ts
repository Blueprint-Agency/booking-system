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
    {
      name: '5-Class Pack',
      kind: 'credit_bundle',
      credits: 5,
      validityDays: 60,
      priceSgd: '120.00',
    },
    {
      name: '10-Class Pack',
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '220.00',
    },
    {
      name: '20-Class Pack',
      kind: 'credit_bundle',
      credits: 20,
      validityDays: 180,
      priceSgd: '400.00',
    },
    {
      name: '1-Month Unlimited',
      kind: 'unlimited',
      durationDays: 30,
      priceSgd: '180.00',
    },
    {
      name: '3-Month Unlimited',
      kind: 'unlimited',
      durationDays: 90,
      priceSgd: '480.00',
    },
  ]).onConflictDoNothing()

  console.log('Seeding PT packages...')
  await db.insert(schema.ptPackages).values([
    {
      name: '5-Session 1-on-1',
      sessionType: '1on1',
      numSessions: 5,
      priceSgd: '450.00',
    },
    {
      name: '10-Session 1-on-1',
      sessionType: '1on1',
      numSessions: 10,
      priceSgd: '850.00',
    },
    {
      name: '5-Session 2-on-1',
      sessionType: '2on1',
      numSessions: 5,
      priceSgd: '300.00',
    },
    {
      name: '10-Session 2-on-1',
      sessionType: '2on1',
      numSessions: 10,
      priceSgd: '560.00',
    },
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
