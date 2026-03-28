# Phase 1 — Product Requirements Document

## Booking & Management System

**Version:** 1.0
**Date:** March 28, 2026
**Status:** Draft
**Audience:** Business Owner / Client

---

## 1. Overview

This document describes the first version of your new booking and management system. It covers everything your business needs to run day-to-day operations: class scheduling, client bookings, payments, attendance tracking, and staff management.

Clients access the system through a dedicated web address on our platform (e.g., `yourbusiness.platform.com`) that works beautifully on phones, tablets, and desktops — no app download required.

### What This Solves

| Problem Today | How the System Helps |
|---|---|
| Manual class management is time-consuming | Automated scheduling, waitlists, and attendance tracking |
| No-shows waste staff time and revenue | Configurable cancellation policies and no-show penalties |
| Payment tracking is scattered | All payments, packages, and invoices in one place |
| Hard to see what's working | Dashboard with occupancy, revenue, and student activity |
| Onboarding new clients is manual | Digital waiver and self-service account creation |

### Goals

- **Fill more sessions** — easy booking, automated waitlists, and real-time availability
- **Reduce no-shows** — cancellation policies, attendance rules, and accountability
- **Save admin time** — automate repetitive tasks like invoicing, waitlist management, and attendance
- **Increase revenue** — sell packages and memberships directly through the system

---

## 2. Who Uses the System

### Clients
Book and pay for sessions, manage their account, and check in at the venue. This is the primary audience — the experience should feel effortless.

### Business Admin / Owner
Full control over the entire system: classes, schedules, clients, staff, finances, and settings. This is the operational command center.

### Instructors
View their assigned class schedule and track their earnings (pay breakdowns, commissions).

### Front-Desk Staff
Handle day-to-day operations like scanning client QR codes for check-in, making manual bookings, and managing walk-ins.

---

## 3. Client Experience

### 3.1 Finding and Booking a Session

When a client visits the booking site, they see available sessions displayed in two ways:

- **Calendar view** — a weekly/monthly calendar showing class times at a glance
- **List view** — a scrollable list, ideal for mobile

Clients can filter sessions by:
- Category (e.g., class type, service type)
- Instructor / staff member
- Level or tier (if applicable)

Each session shows:
- Date, time, and duration
- Instructor name
- Available spots (real-time)
- Price or package eligibility

**Booking flow:**
1. Select a class
2. Confirm booking (one or two clicks)
3. Receive confirmation (on-screen + email)

If a session is full, the client can join the waitlist. They are automatically moved in if a spot opens up and notified immediately.

### 3.2 Paying for Sessions

Clients can pay in the way that suits them:

- **Pay per session** — single payment at the time of booking
- **Session packages** — buy a bundle (e.g., 5 or 10 sessions) and use them over time
- **Monthly memberships** — recurring subscription for unlimited or set number of sessions per month

All payments are processed securely via credit or debit card (powered by Stripe). Clients see a clear breakdown before confirming payment.

### 3.3 My Account

Every client has a personal account where they can:

- **View upcoming bookings** — see what's scheduled, with session details
- **Cancel or reschedule** — within the business's cancellation policy window
- **Track package balance** — see how many sessions remain in a purchased package
- **View history** — past bookings, attendance records, and payment receipts
- **Access invoices** — download or review any invoice from previous purchases

### 3.4 Digital Waiver (First-Time Onboarding)

Before attending their first session, new clients complete a digital waiver form:
- The form appears automatically during the first booking or account setup
- Clients read and e-sign the waiver on their device
- The signed waiver is stored securely under their profile
- Admin can access it at any time for compliance purposes

No paper forms, no scanning — it's handled once and stored permanently.

---

## 4. Admin Experience

### 4.1 Class & Schedule Management

Create and manage your full class schedule from a single dashboard:

- **Create classes** with details: name, type, level, duration, instructor, price
- **Set recurring schedules** — e.g., "Beginner Class every Monday and Wednesday at 9am"
- **Define capacity** — maximum clients per session
- **Waitlist rules** — enable/disable waitlists, set maximum waitlist size
- **Late-entry rules** — set a cutoff time (e.g., clients cannot check in more than 10 minutes after a session starts)
- **Workshops & special events** — create one-off sessions with custom pricing and capacity

Changes to the schedule are reflected immediately on the student booking site.

### 4.2 Booking Management

See who's in every class and manage bookings hands-on:

- **Session rosters** — view the full list of booked clients for any session
- **Manual add/remove** — add a client to a session or remove them (e.g., phone bookings, walk-ins)
- **Automated waitlist filling** — when a client cancels, the next person on the waitlist is automatically booked in and notified
- **Attendance status** — mark each client as: Attended, Late, or No-Show

### 4.3 Client CRM

A complete profile for every client, all in one place:

- **Contact details** — name, email, phone number
- **Package status** — active packages, remaining sessions, expiry dates
- **Membership status** — current plan, renewal date
- **Attendance history** — full record of sessions attended, late arrivals, and no-shows
- **Notes** — add private notes about a client (e.g., health considerations, preferences, special accommodations)

#### QR Code Check-In

Each client has a unique QR code in their account (accessible on their phone). Here's how check-in works:

1. Client arrives and shows their QR code on their phone
2. Front-desk staff scans it using any device with a camera
3. System confirms check-in and records attendance
4. If the client arrives more than the configured late cutoff (default: 10 minutes after session start), check-in is blocked and they are marked as a no-show

This replaces manual roll calls and ensures accurate attendance records.

### 4.4 Instructor Management

Manage your teaching team:

- **Assign instructors to classes** — link each class to its instructor
- **View instructor schedules** — see each instructor's upcoming classes at a glance
- **Compensation tracking** — the system calculates and displays what each instructor is owed based on configurable rates:
  - Base pay per session taught
  - Commission per client attending
  - Commission on revenue generated
  - Extra hour pay
  - Special workshop rates

Compensation reports are for visibility only — actual payment to instructors is handled outside the system.

### 4.5 Staff Management

Manage your team beyond instructors:

- **Staff accounts** — create accounts for front-desk staff, managers, etc.
- **Roles & permissions** — control what each staff member can see and do
- **Leave management** — staff can submit leave requests; admin can approve or reject them
- **Calendar visibility** — see who's working on any given day

### 4.6 Sales Tracking

Know who's selling and how much:

- **Track package and membership sales by staff member** — see which team member sold what
- **Commission calculation** — the system calculates sales commission based on your rules and displays it in reports

### 4.7 Payments & Packages

Full control over your pricing and revenue:

- **Create pricing options:**
  - Single session prices
  - Session packages (e.g., 5 sessions for $X, 10 sessions for $Y)
  - Monthly memberships (recurring billing)
- **Transaction history** — view all payments, filterable by date, client, or type
- **Stripe dashboard** — all card payments flow through Stripe for security and reliability

### 4.8 Invoices

Every purchase automatically generates a professional invoice:

- Sent to the client's email immediately after payment
- Stored in the client's account for future reference
- Accessible to admin at any time
- Includes: date, description, amount paid, payment method

### 4.9 Dashboard & Analytics

A real-time overview of your business's performance:

- **Session occupancy rate** — how full are your sessions? Which ones are consistently under-booked?
- **Revenue tracking** — daily, weekly, and monthly revenue trends
- **Active vs. inactive clients** — how many clients are actively booking vs. those who haven't visited recently
- **Package sales performance** — which packages sell best, revenue by package type

---

## 5. Configurable Business Policies

The system ships with sensible default rules, but everything can be adjusted by the admin to match your business's way of working:

### Cancellation Policy
- Set a cancellation window (e.g., "clients must cancel at least 12 hours before a session")
- Define what happens if they cancel late (e.g., session deducted from package, or a penalty fee)
- Choose whether late cancellations count as no-shows

### No-Show Policy
- Track no-shows automatically via attendance records
- Set consequences (e.g., after 3 no-shows in a month, client receives a warning or booking restriction)

### Waitlist Rules
- Enable or disable per class
- Set maximum waitlist size
- Automatic promotion: when a spot opens, the next student on the waitlist is booked in and notified

### Late-Entry Cutoff
- Set the grace period (default: 10 minutes after session start)
- After the cutoff, clients cannot check in and are marked as a no-show

---

## 6. User Experience Principles

The system is designed around these principles:

- **Mobile-first** — most clients will book from their phone. The experience is optimized for small screens first, and scales up beautifully on tablets and desktops.
- **Minimal clicks** — booking a session should take no more than 1-2 taps. No unnecessary steps, forms, or confirmations.
- **Real-time** — slot availability updates instantly. No risk of double-booking or stale information.
- **Clear feedback** — every action (booking, cancellation, payment) gives the client immediate, clear confirmation on screen and via email.
- **Clean, modern design** — a professional, uncluttered interface that reflects well on your brand.

---

## 7. How We Measure Success

After launch, we will track these metrics to ensure the system is delivering value:

| Metric | What It Tells Us |
|---|---|
| **Session fill rate** | Are more spots being filled compared to before? |
| **No-show rate** | Are no-shows decreasing with policies and accountability? |
| **Admin time saved** | How many hours per week are freed up from manual tasks? |
| **Client retention** | Are clients coming back and staying active? |
| **Package conversion rate** | Are clients buying packages/memberships vs. single sessions? |

---

## 8. What's Not Included in Phase 1

The following features are planned for future phases and are **not** part of this initial launch:

- Online/hybrid classes (Zoom integration, recorded sessions)
- Referral program (referral codes and rewards)
- WhatsApp / SMS notifications and marketing
- Automated marketing campaigns
- Loyalty and points system
- PayNow and GrabPay payment methods

These will be prioritized based on business needs after the core system is running.

---

## 9. How Clients Access the System

Clients will access the booking system through a dedicated web address on our platform, such as:

> `yourbusiness.platform.com`

This is a standalone, responsive website — no app download needed. It works on any device with a web browser: phones, tablets, laptops, and desktops.

The URL can be shared on your social media, printed on flyers, or linked from your existing website.
