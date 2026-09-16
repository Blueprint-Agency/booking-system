# Email deliverability runbook

**Status:** active from 2026-09-16.
**Scope:** the one platform sender, `noreply@reservetoday.app`, on the Resend Free plan. Every studio's mail leaves on it.
**Issues:** #155 (this doc), parent #126 (row 7 of #129). The invitation batch plan below is handed to #130.
**Numbers:** every Resend figure here comes from [`research-resend-sending-limits.md`](research-resend-sending-limits.md) (checked 2026-09-16), cited as *R§n*. Figures marked *our choice* are planning decisions, not Resend limits.

Why this exists: on 2026-09-13 the first message from `reservetoday.app` landed in Gmail spam with SPF, DKIM and DMARC all passing. The domain is new and has no reputation. Sign-in codes and staff second factors depend on that reputation, and the cutover invitations are the one send that can wreck it.

## Limits we plan against

| Limit | Value | Source |
|---|---|---|
| Free plan, daily | 100 emails a day, every studio combined; UTC day, resets at midnight UTC | R§2 |
| Free plan, monthly | 3,000 emails a month | R§2 |
| What counts | each recipient (`To`/`CC`/`BCC`) is one email | R§2 |
| API rate | 10 requests a second, team-wide, shared by staging and production keys | R§1 |
| Pause thresholds | bounce rate above 4%, or spam rate above 0.08%, "may result in a temporary pause in sending" (the team shares one account) | R§2 |
| New-domain warm-up ceiling | day 1: 150 · day 2: 250 · day 3: 400 · day 4: 700 (50/h) · day 5: 1,000 (75/h) · day 6: 1,500 (100/h) · day 7: 2,000 (150/h) | R§7 |
| Complaints from Gmail | none sent; use Gmail Postmaster Tools instead | R§6 |
| Resend event history | 30 days | R§6 |

On Free, the 100-a-day cap is lower than every step of Resend's warm-up curve (R§2, R§7). So on Free the cap, not the curve, is what limits us.

## Roles

Fill these in. Until a name is written here, the role is unowned and the warm-up is not running.

| Role | Does | Who |
|---|---|---|
| **Warm-up sender** | Sends real mail from the platform every day (see §1) and ticks the log | _TBD (name)_ |
| **Deliverability owner** | Receives bounce / complaint / quota alerts (#153, #154), reads Postmaster on the check dates, calls the stop rule | _TBD (name)_ |
| **Gate runner** | Runs the inbox gate (§2) on the rehearsal day and records the result | _TBD (name)_ |

---

## 1. Warm-up schedule

**Goal:** steady, real, low-complaint mail every day. Never a blast. Being far below Resend's curve is fine (R§7: "send at a consistent rate and avoid any spikes").

**What counts as warm-up mail** — real messages from the real flows, to mailboxes the team reads and opens:

- team members signing in to the member app by email code;
- staff second-factor codes on portal sign-in;
- test bookings and purchases by team accounts, which send confirmations;
- mail across Gmail, Outlook and iCloud mailboxes, not only one provider.

**Not warm-up mail:** third-party "warm-up services" (Resend says avoid them, R§7), mail to made-up addresses (bounces count against us, R§2), bulk sends of any kind.

**Rules for every day**

- Stay at or under the daily target below. The hard cap is 100 for all studios together (R§2); real member mail on staging and production counts too.
- If a message lands in spam: open it, mark it *Not spam*, move it to the inbox, and note it in the log. That is a real signal to the provider.
- Any bounce or complaint alert: stop, tell the deliverability owner, do not raise the next day's target.

### Daily targets (*our choice*, inside the 100/day Free cap, R§2)

On batch days (§3) the warm-up target drops to whatever fits in the day's everyday budget; invitation mail and the sign-ins it causes are then the daily real mail.

| Week | Dates | Warm-up mail a day | Notes |
|---|---|---|---|
| 1 | Wed 2026-09-16 – Tue 2026-09-22 | 10–15 | Sign-ins and 2FA only |
| 2 | Wed 2026-09-23 – Tue 2026-09-29 | 15–25 | Add test bookings and purchases |
| 3 | Wed 2026-09-30 – Tue 2026-10-06 | 25–35 | All three providers every day |
| 4 | Wed 2026-10-07 – Tue 2026-10-13 | 30–40 | Hold steady |
| 5 onward | Wed 2026-10-14 → cutover | 30–40 | Hold steady until invitations start (§3) |

The top of the range stays at 40 so real member and staff mail on the same team still has 60 a day of room (R§2).

### Check dates

| Date | Check | Result |
|---|---|---|
| Wed 2026-09-23 | Postmaster: domain reputation, spam rate, authentication. Resend: bounce and complaint rates | |
| Wed 2026-09-30 | Same | |
| Wed 2026-10-07 | Same | |
| **Wed 2026-10-14** | Same, **plus DMARC tightening review** (see below) | |
| Wed 2026-10-21 | Same | |
| Every Wednesday after, until cutover ends | Same | |

Postmaster may show no data at low volume. "No data" is recorded as "no data", not as "fine" (*observation to record*; Postmaster's volume threshold is not in the research note).

A check passes when: Resend bounce rate is well under 4% and spam rate well under 0.08% (R§2), and Postmaster shows no drop since the last check.

### DMARC tightening review — Wed 2026-10-14

On this date (infra #16), the deliverability owner decides whether to tighten the `reservetoday.app` DMARC policy. Tighten only if:

- DMARC reports show Resend mail aligned (SPF or DKIM) on every day since the last review;
- no spoof-looking sources appear in the reports that we would still need;
- the checks above have passed.

If not, set the next review date here and keep the current policy.

Next review (if deferred): _____

### Daily log

Keep one line a day. The log is the proof that warm-up happened.

| Date (UTC) | Sent (approx.) | Providers | Any spam placement? | Any alert? | Initials |
|---|---|---|---|---|---|
| 2026-09-16 | | | | | |

---

## 2. Deliverability gate (cutover checklist)

**Hard gate. Fail means no invitations.** It goes on #130's pre-blast checklist.

**When:** the blast-rehearsal day in #130's cutover plan, on the **production** sender, before the first invitation batch. Rerun it if the invitation template changes after the gate.

**Mailboxes:** three **fresh** mailboxes, never used to receive mail from us, not in any contact list:

- one Gmail (`@gmail.com`),
- one Outlook (`@outlook.com` or `@hotmail.com`),
- one iCloud (`@icloud.com`).

**Steps, for each mailbox**

1. Trigger a real member sign-in on the member app with that address. It must receive the sign-in code.
2. Send it the real cutover invitation template, through the same path the batches will use (the everyday lane of the send gate, #153).
3. Wait up to 10 minutes (*our choice*). Without opening, moving or marking anything first, note which folder each message landed in.

**Pass:** all six messages (3 mailboxes × code + invitation) are in the inbox. For Gmail, the Primary, Updates or Promotions tab counts as inbox; Spam does not. For Outlook, Focused or Other counts; Junk does not.

**Fail:** any one message in spam or junk, or not arrived in 10 minutes. Then:

- no invitations go out;
- the deliverability owner looks at the headers (SPF / DKIM / DMARC pass?), Postmaster, and the Resend bounce and spam rates (R§2);
- warm-up continues (§1) and the gate is rerun on a later date with **new** fresh mailboxes.

### Gate record

| Date (UTC) | Runner | Gmail code | Gmail invite | Outlook code | Outlook invite | iCloud code | iCloud invite | Result |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Write *inbox* / *spam* / *missing* in each cell. Result is **PASS** only if every cell is *inbox*.

---

## 3. Invitation batch plan (for #130)

About **800** members are invited at cutover (R, "Context" paragraph at the top). Invitations are the one real threat to the sender every sign-in code depends on. So they go out slowly, clean, and with a stop rule.

### Step 1 — clean the list first

Before anything is sent, drop or set aside:

| Drop | Why |
|---|---|
| Missing or invalid addresses (no `@`, no domain, typos like `gmial.com`) | A certain bounce. Bounces above 4% can pause the team (R§2). List these for the studio to fix. |
| Addresses that bounced before (Mindbody bounce / undeliverable flags, if the export has them) | Likely to hard-bounce again, and each hard bounce counts toward the 4% pause threshold (R§2). Resend only suppresses bounces it saw itself (R§6), so Mindbody's own bounce history must be dropped by hand. |
| Addresses already on Resend's suppression list | Resend will not deliver to them anyway (R§6). |
| Long-inactive members: no visit and no purchase in the last 12 months (*our choice*) | Old addresses are the likeliest to bounce (R§2 threshold) or be marked as spam (R§2 threshold); Resend's advice is to start with the recipients most likely to engage (R§7: start small, build up). *Our choice* of cut-off. Hand this list to the studio; they decide whether to invite them last, in their own small batches, or not at all. |

Record the counts: total, dropped per reason, left to invite.

### Step 2 — pass the gate

§2 must show **PASS** before batch 1.

### Step 3 — send in small daily batches

- **Lane:** every invitation goes through the ordinary **everyday lane** of the send gate (#153). The gate paces them under the rate limit (10 requests a second, R§1) and sends sign-in codes first. No separate script calls Resend directly.
- **Order:** most recently active members first (*our choice*, following the research note's recommendation in R§9 item 6). They are the most likely to open, which helps the rest.
- **Timing:** start each batch in the studio's morning, and spread it over a few hours, not all at once (R§7: "avoid any spikes").
- **Leave room for sign-in codes.** Each invitation can cause a sign-in code the same day when the member accepts. So a batch of *N* invitations can cost up to *2N* of the day's 100 (R§2). Plus the daily warm-up and real studio mail.
- **Batch API:** not needed at this volume. If #130 uses it anyway, one idempotency key per batch (R§3, R§4).

### How long 800 invitations take

**On Free (100 a day, R§2):**

| Day's budget (*our choice*) | Emails |
|---|---|
| Invitations | 35 |
| Sign-in codes those invitations can trigger (worst case, one each) | 35 |
| Everyday mail for all studios, including warm-up | 30 |
| **Total** | **100** |

Even on Free the batches ramp, in the spirit of Resend's curve (R§7: start small, no spikes): **20** invitations on day 1, **25** on day 2, **30** on day 3, then **35** a day. That is 75 over the first three days, then 20 days of 35 (700), then 25 on the last day: **800 invitations take 24 sending days on Free.** That is the plan.

The absolute floor on Free is about **10 days** (80 invitations a day, leaving 20 for everything else). That leaves no room for accept-day sign-in codes and would hit the daily cap, which blocks sign-in codes until midnight UTC (R§2). **Do not plan on it.**

Monthly check on Free: over 24 days, up to 800 invitations + 800 sign-in codes + ~720 everyday mail ≈ 2,320, under the 3,000 a month (R§2), if the batches fit in one monthly window. If they cross into the next window, recheck both months.

**On Pro (no daily cap, 50,000 a month, R§2)** the limit becomes Resend's warm-up curve (R§7). The same worst case applies: *N* invitations can cost *2N*, so invitations stay at half the ceiling or less, and under half the hourly cap where one exists:

| Day | Warm-up ceiling (R§7) | Invitations (*our choice*) | Worst case with codes |
|---|---|---|---|
| 1 | 150 | 75 | 150 |
| 2 | 250 | 100 | 200 |
| 3 | 400 | 175 | 350 |
| 4 | 700, 50/h max | 250, ≤ 25 an hour over 10+ hours | 500, ≤ 50/h |
| 5 | 1,000, 75/h max | 200, ≤ 35 an hour | 400, ≤ 70/h |
| **Total** | | **800 in 5 days** | |

Everyday mail for all studios also counts toward each day's ceiling, so on a busy day the batch is trimmed to fit.

**Pro decision for #130:** about **24 days on Free versus about 5 days on Pro** (from $20/month, R§2). Decide before cutover, against these numbers.

### Stop rule

Stop sending the rest of the day's batch, and hold the next day's, on **any** of:

- a hard-bounce, complaint or suppression alert (#154);
- a quota alert (#153) — sign-in codes are then failing too (R§2);
- Postmaster domain reputation lower than at the last check, or its spam rate higher (*our choice* of trigger; Postmaster is the only Gmail spam signal, R§6);
- Resend bounce rate nearing 4% or spam rate nearing 0.08% (R§2).

**To restart:** the deliverability owner finds the cause (bad addresses? a template problem? one provider?), removes the bad addresses, and restarts at **half** the last day's batch size (*our choice*). Gmail sends no complaint events, so its signal is Postmaster only (R§6).

### Batch log

| Day | Date (UTC) | Invitations sent | Bounces | Complaints | Postmaster | Stopped? | Initials |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

---

## Open items

- Name the three roles above.
- Confirm on the Resend dashboard the team's actual rate limit and plan (R, "Could not verify").
- Record what is observed for: quota refusals carrying `retry-after` and sends to suppressed addresses (R, "Could not verify"), and the lowest daily volume at which Postmaster starts showing data (not covered by the research note).
