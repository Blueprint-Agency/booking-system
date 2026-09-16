# Research: Sending with Resend — rate limits, quotas, retries, deliverability

**Date checked:** 2026-09-16 · **Primary sources only**: resend.com/docs (read as the raw `.md` pages Resend publishes via `https://resend.com/docs/llms.txt`), resend.com/pricing, resend.com/changelog, and Resend's own GitHub repos (`resend/resend-node`, `resend/resend-skills`, `resend/email-best-practices`), plus the installed SDK bundle in `be/node_modules/resend/dist`. Every claim carries its source URL. Anything not confirmed from a primary source is marked **UNVERIFIED**. Recommendations are kept apart, in the last section.

**Context:** `be/src/lib/mailer.ts` sends every message through `resend.emails.send`, one verified domain (`reservetoday.app`), one `noreply@` sender, per-studio display name + Reply-To. On `rate_limit_exceeded` it waits 600 / 1200 / 1800 ms and retries up to 3 times, then throws; `sendTemplatedEmail` records the throw as `failed` in `email_log`. Mail types: member sign-in codes, staff 2FA codes, booking/purchase transactional mail, admin notifications, and a planned one-off invitation send to ~800 members at cutover. The domain is new (first message landed in Gmail spam with SPF/DKIM/DMARC passing). No Resend webhook is wired up.

**SDK:** `be/package.json` pins `"resend": "^6.28.0"`; installed version is **6.28.0** (`be/node_modules/resend/package.json`). Latest on `main` of resend-node is 6.28.1 (https://raw.githubusercontent.com/resend/resend-node/main/package.json).

---

## 1. API rate limit

- **Default: 10 requests per second, per team.** "The default maximum rate limit is **10 requests per second per team**. This limit applies across all API keys associated with your team. This number can be increased for trusted senders upon request. You can view your team's current rate limit on the Settings Usage page."
  Source: https://resend.com/docs/api-reference/rate-limit
- **Scope is the team, not the key or domain.** "The rate limit is **per team**, not per API key or per domain. All API keys associated with your team share the same rate limit pool." Staging and production using keys on the same team therefore share one pool.
  Source: https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **No burst allowance; strict per-second window.** "The rate limit is enforced as a per-second window. There is no separate burst allowance above the stated limit. If your limit is 10 requests per second, an eleventh request in the same second window will receive a `429` response."
  Source: https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **Raising it:** "If you have specific requirements, contact support to request a rate increase"; Enterprise lists "Enterprise rate limits".
  Sources: https://resend.com/docs/api-reference/rate-limit · https://resend.com/pricing
- **Response headers** (on every response, per IETF draft-ietf-httpapi-ratelimit-headers-06):
  | Header | Meaning |
  |---|---|
  | `ratelimit-limit` | Maximum number of requests allowed within a window |
  | `ratelimit-remaining` | Requests left in the current window |
  | `ratelimit-reset` | Seconds until the limits are reset |
  | `retry-after` | Seconds to wait before making a follow-up request |

  Source: https://resend.com/docs/api-reference/rate-limit (headers first announced 2023-05-24: https://resend.com/changelog/api-rate-limit)
- **Error:** HTTP `429`, name `rate_limit_exceeded`, message "Too many requests. Please limit the number of requests per second…", action "Reduce request rate via queue/concurrent limits; contact support for increases."
  Source: https://resend.com/docs/api-reference/errors
- Resend's own mitigation advice: "introducing a queue mechanism or reducing the number of concurrent requests per second"; for spikes: batch sending, "Client-side throttling: Use the rate Limit headers to configure client-side throttling", and asking support in advance.
  Sources: https://resend.com/docs/api-reference/rate-limit · https://resend.com/docs/knowledge-base/account-quotas-and-limits

> **Discrepancy with our code:** the comment in `mailer.ts` says "Resend allows 2 requests a second". Resend's docs today say the default is 10 req/s. Our team's *actual* limit may differ from the default (the docs point to the Settings Usage page), so it should be read from `ratelimit-limit` rather than hard-coded. **UNVERIFIED:** what our team's limit actually is — only visible in the dashboard or on a live response header.

## 2. Sending quotas (daily / monthly)

### Per plan (transactional)

| Plan | Price (entry tier) | Monthly emails | Daily limit | Domains | Overage |
|---|---|---|---|---|---|
| Free | $0 | 3,000 | **100 / day** | 3 | none |
| Pro | $20/mo | 50,000 (higher tiers on slider, e.g. 100,000) | none ("No daily email limit") | 10 | $0.90 / 1,000 |
| Scale | $90/mo | 100,000 (tiers up to 2.5M) | none | 1,000 | $0.90 / 1,000 at entry tier, cheaper at higher tiers |
| Enterprise | custom | custom (3M+) | — | by contract | volume-based |

Sources: https://resend.com/pricing · https://resend.com/docs/knowledge-base/account-quotas-and-limits

Additional quota rules:
- "The daily quota applies only to the Free plan. It is a UTC calendar day (00:00–24:00 UTC) and resets at midnight UTC — not a rolling 24-hour window. Paid sending plans have no daily quota, only the monthly limit."
  Source: https://resend.com/docs/api-reference/rate-limit
- **Recipients, not requests, are counted.** "Multiple `To`, `CC`, or `BCC` recipients in sent emails count as separate emails towards this quota." And "Both sent and received emails count towards these quotas."
  Sources: https://resend.com/docs/knowledge-base/account-quotas-and-limits · https://resend.com/docs/api-reference/rate-limit
- **Overages on paid plans** are pay-as-you-go, billed "in buckets of 1,000 emails", enabled in team settings under "Transactional Overages"; the pricing page warns that without pay-as-you-go enabled, exceeding plan limits stops sending (sentence truncated in the fetched page). Overage is hard-capped: "By default, overage usage is capped at **5x your plan's monthly quota**. Once you reach this limit, sending will be paused until the next billing cycle."
  Sources: https://resend.com/pricing · https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **Reputation-based pauses (separate from quota):** "Maintaining a bounce rate above 4% may result in a temporary pause in sending"; "Maintaining a spam rate over 0.08% may result in a temporary pause in sending."
  Source: https://resend.com/docs/knowledge-base/account-quotas-and-limits

### When a quota is exceeded

| Error name | HTTP | Resend's action |
|---|---|---|
| `daily_quota_exceeded` | 429 | "Upgrade plan or wait 24 hours" / "wait for the quota to reset at midnight UTC" |
| `monthly_quota_exceeded` | 429 | "Upgrade your plan to increase quota" |

Sources: https://resend.com/docs/api-reference/errors · https://resend.com/docs/api-reference/rate-limit

- **Distinguishable from the per-second limit?** Yes by `error.name`, **not** by status: all three are HTTP 429. The installed SDK's error type enumerates `'monthly_quota_exceeded' | 'daily_quota_exceeded' | 'rate_limit_exceeded'` separately (`be/node_modules/resend/dist/index.d.mts`, `RESEND_ERROR_CODE_KEY`). Anything keyed on `statusCode === 429` alone will treat quota exhaustion as a transient rate limit.
- **Quota usage headers:** "`x-resend-daily-quota` — Your used daily email sending quota. Only sent to free plan users." and "`x-resend-monthly-quota` — Your used monthly email sending quota." (all plans).
  Source: https://resend.com/docs/api-reference/rate-limit
- **UNVERIFIED:** whether `retry-after` is set on quota 429s (and to what); the docs describe it only generically.

> Note: Resend's own agent-skill guides (`resend-skills`, `email-best-practices`) say "retry 429 with backoff" without separating quota 429s from rate-limit 429s. The errors reference is the more specific source and shows quota 429s are not solved by waiting seconds.

## 3. Batch API (`resend.batch.send`)

- **Max 100 emails per call.** "Resend provides a batching endpoint that permits you to send up to 100 emails in a single API call." Each can have different recipients, subject and content. Each email's `to` is still "Max 50".
  Sources: https://resend.com/docs/api-reference/emails/send-batch-emails · https://resend.com/docs/dashboard/emails/batch-sending
- **One request against the rate limit.** "Batch sending: Use the Batch Email API to send up to 100 emails in a single API call. **Each batch request counts as one request against your rate limit.**"
  Source: https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **Limitations:** "The `attachments` field is not supported yet." `scheduled_at`, `tags`, `headers`, `reply_to`, `template`, `topic_id` are all documented body params on the batch endpoint. "Each email in a batch request can be scheduled independently."
  Sources: https://resend.com/docs/api-reference/emails/send-batch-emails · https://resend.com/docs/dashboard/emails/schedule-email · https://resend.com/docs/dashboard/emails/tags
- **Response:** "each entry in `data` corresponds to the email at the same index in the batch payload (0-based)."
  Source: https://resend.com/docs/api-reference/emails/send-batch-emails
- **Validation mode (SDK source only):** the Node SDK sends header `x-batch-validation: strict` by default and accepts `batchValidation: 'strict' | 'permissive'`; in permissive mode the response adds `errors: { index, message }[]`.
  Sources: `be/node_modules/resend/dist/index.mjs` (Batch `create`) · https://raw.githubusercontent.com/resend/resend-node/main/src/batch/interfaces/create-batch-options.interface.ts
  **UNVERIFIED:** the API reference page does not document `x-batch-validation`, so the exact semantics of `strict` (presumably: one invalid email rejects the whole batch) are inferred from the SDK types, not stated by Resend's docs.
- **Quota counting:** **UNVERIFIED as a direct statement for batch.** Resend says quotas count emails and each recipient separately (§2), so a 100-email batch should consume 100 quota units, but no page says so for batch explicitly.

## 4. Idempotency keys

- Supported on `POST /emails` and `POST /emails/batch` only. Header `Idempotency-Key` (SMTP: `Resend-Idempotency-Key`). Node SDK option: second argument `{ idempotencyKey }`.
  Source: https://resend.com/docs/dashboard/emails/idempotency-keys
- **Lifetime 24 hours; max 256 chars.** "Idempotency keys are kept in the system for **24 hours**." "Idempotency keys can be up to 256 characters and must be unique per API request."
  Source: https://resend.com/docs/dashboard/emails/idempotency-keys
- **Behaviour:** same key + same payload → "our API will give the same response, without actually sending the email again." Same key + different payload → `409 invalid_idempotent_request`. Same key while the first request is still in flight → `409 concurrent_idempotent_requests` ("Retry later"). Bad key → `400 invalid_idempotency_key`.
  Sources: https://resend.com/docs/dashboard/emails/idempotency-keys · https://resend.com/docs/api-reference/errors
- **Key format:** recommended `<event-type>/<entity-id>`, e.g. `welcome-user/123456789`; "For batch sends, choose a key that represents the whole batch".
  Source: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend's guide stresses determinism: "If you retry the same logical send, the same key must be generated. Avoid `Date.now()` or random values generated fresh on each attempt." Its skill guide suggests `<batch-prefix>/chunk-<index>` for chunked large batches.
  Sources: https://raw.githubusercontent.com/resend/email-best-practices/main/references/sending-reliability.md · https://raw.githubusercontent.com/resend/resend-skills/main/skills/resend/references/sending/best-practices.md
- **Installed SDK supports it:** `if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey)` (`be/node_modules/resend/dist/index.mjs`).
- Engineering background (Resend blog, primary): https://resend.com/blog/engineering-idempotency-keys (listed by search; not read in full).

## 5. Retry strategy per Resend

- **The SDK does not retry.** v6.28.0 `fetchRequest` performs one `fetch` and returns `{ data, error, headers }`; there is no retry/sleep logic in the bundle (`be/node_modules/resend/dist/index.mjs`). It also **does not throw** on API errors; network failures come back as `application_error` with `statusCode: null`.
- **The SDK exposes response headers** on success and error: `headers: Object.fromEntries(response.headers.entries())` — so `retry-after`, `ratelimit-*` and `x-resend-monthly-quota` are readable from the result. (`be/node_modules/resend/dist/index.mjs`)
- **Retryable vs not (Resend's errors reference):**
  - Retry later: `rate_limit_exceeded` (429), `application_error` (500), `service_unavailable` (503), `concurrent_idempotent_requests` (409), `resource_locked` (409 "Retry after short delay").
  - Wait for reset / upgrade (not a short retry): `daily_quota_exceeded`, `monthly_quota_exceeded` (429).
  - Fix the request, do not retry: `validation_error` (400/403 — includes unverified domain), `invalid_idempotency_key` (400), `missing_api_key` / `restricted_api_key` (401/403), `suspended_api_key` (403), `invalid_idempotent_request` (409), `invalid_attachment` / `missing_required_field` / `invalid_parameter` (422), `not_found`, `method_not_allowed`.
  Source: https://resend.com/docs/api-reference/errors
- **Backoff guidance** (Resend's official best-practice repos, not the docs site): exponential backoff with jitter, "Backoff schedule: 1s → 2s → 4s → 8s", cap 30 s, "Max 3-5 retries", "Always use idempotency keys when retrying", retry 5xx, 429, network timeouts; never 4xx. For critical mail, "use a queue": write pending → send → mark sent / schedule retry / mark failed and alert. Timeouts: "10-30 seconds for email API calls."
  Sources: https://raw.githubusercontent.com/resend/email-best-practices/main/references/sending-reliability.md · https://raw.githubusercontent.com/resend/resend-skills/main/skills/resend/references/sending/best-practices.md
- **Honouring `retry-after`:** the docs define `retry-after` as "How many seconds to wait before making a follow-up request" (https://resend.com/docs/api-reference/rate-limit). Resend does not publish an explicit "prefer retry-after over your own backoff" rule; that part is a recommendation (§9).

## 6. Webhooks, bounces, suppression

- **Email event types:** `email.sent`, `email.delivered`, `email.delivery_delayed` ("couldn't be delivered due to a temporary issue"), `email.bounced` ("recipient's mail server permanently rejected the email"), `email.complained` ("marked it as spam"), `email.failed` ("failed to send due to an error"), `email.suppressed` ("suppressed by Resend"), `email.opened`, `email.clicked`, `email.scheduled`, `email.received`. Also `domain.created|updated|deleted`, `contact.created|updated|deleted`, `suppression.added|removed`.
  Source: https://resend.com/docs/dashboard/webhooks/event-types (canonical index: https://resend.com/docs/webhooks/event-types.md)
- **Bounce payload** carries `data.bounce.type` (`Permanent` / `Transient` / `Undetermined`), `subType`, `message`, plus `data.email_id` and `data.tags`.
  Sources: https://resend.com/docs/webhooks/introduction · https://resend.com/docs/dashboard/emails/email-bounces
- **Signature verification is Svix.** Headers `svix-id`, `svix-timestamp`, `svix-signature`; verify with `resend.webhooks.verify({ payload, headers, webhookSecret })` or the `svix` library. Must use the **raw** body: "Some frameworks parse the request as JSON and then stringify it, and this will also break the signature verification."
  Source: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
- **Delivery semantics:** at-least-once — "use the `svix-id` header … Store processed `svix-id` values and skip any duplicates"; "delivery order is not guaranteed" (sort by `created_at`). Respond 200. Retries: immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h; failing endpoints trigger an email to the team and are eventually auto-disabled. Events can be replayed.
  Sources: https://resend.com/docs/webhooks/introduction · https://resend.com/docs/webhooks/retries-and-replays
- **Resend auto-suppresses.** "When sending to an email address results in a hard bounce or spam complaint, Resend places this address on the Suppression List. Future emails to addresses on the list will be marked as `suppressed` and won't be delivered until the address is removed." Suppressions are team-wide, "across all your domains and subdomains". Origins: `bounce`, `complaint`, `manual`. Manageable via dashboard or API (single, or batch of 100).
  Sources: https://resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list · https://resend.com/docs/dashboard/emails/email-suppressions
- **Gmail does not report complaints:** "Not all Inbox Service Providers return a `complained` event, most notably, Gmail/Google Workspace." Resend points to Gmail Postmaster Tools for spam reports.
  Sources: https://resend.com/docs/dashboard/emails/email-suppressions · https://resend.com/docs/knowledge-base/how-do-i-avoid-gmails-spam-folder
- **Data retention is 30 days** on Free/Pro/Scale; Resend suggests storing webhook events yourself for longer history.
  Source: https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **UNVERIFIED:** whether a send to a suppressed address returns an API error or a normal `200` with the message later marked `suppressed`. The docs describe it as a status in the Emails dashboard plus the `email.suppressed` event, which implies the API call itself succeeds.

## 7. Deliverability guidance Resend publishes

- **Warm-up for a new domain** — "Before you start sending emails with a brand new domain, it's especially important to have a warm-up plan":
  | Day | Messages/day | Messages/hour |
  |---|---|---|
  | 1 | up to 150 | — |
  | 2 | up to 250 | — |
  | 3 | up to 400 | — |
  | 4 | up to 700 | 50 max |
  | 5 | up to 1,000 | 75 max |
  | 6 | up to 1,500 | 100 max |
  | 7 | up to 2,000 | 150 max |

  "The goal is to send at a consistent rate and avoid any spikes in email volume." Keep bounce rate below 4% and spam rate below 0.08%; if they rise, slow the warm-up. Avoid third-party "warm-up services".
  Source: https://resend.com/docs/knowledge-base/warming-up
- **Establish sending patterns (Gmail):** "Sending a large volume of emails from a new domain will likely result in poor inbox placement. Instead, start small and build up your sending volume over time." "Send transactional emails before sending marketing emails." "Choose dedicated sending addresses for each type of email" (e.g. `notifications@` for transactional, `updates@` for marketing). Host the website on the sending domain; keep links on the sending domain; simpler content.
  Source: https://resend.com/docs/knowledge-base/how-do-i-avoid-gmails-spam-folder
- **Subdomain, not root:** "We recommend sending emails from a subdomain (`notifications.acme.com`) instead of your root/apex domain" — for reputation isolation and "sending purpose transparency". Avoid lookalike domains.
  Source: https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain
- **Auth mail on its own subdomain:** "if you use `auth.example.com` for your authentication emails, you are communicating to the inbox provider that all emails from this subdomain are related to sending authentication emails", or one subdomain for all transactional mail (`notifications.example.com`).
  Source: https://resend.com/docs/knowledge-base/how-do-i-maximize-deliverability-for-supabase-auth-emails
- **Tracking off for transactional mail:** "Open and click tracking is disabled by default for all domains. We suggest only tracking open rates for Broadcasts to ensure that inbox providers do not mistakenly identify your transactional emails as marketing emails." "This kind of tracking can actually hurt your deliverability"; link tracking can break single-use links; link scanners may `GET` single-use links.
  Sources: https://resend.com/docs/dashboard/domains/tracking · https://resend.com/docs/knowledge-base/how-do-i-maximize-deliverability-for-supabase-auth-emails
- **List-Unsubscribe:** transactional mail is "generally exempt" from an unsubscribe link, but mail that is more about "nurturing relationships" should offer one. Pass `List-Unsubscribe` via `headers`; for bulk mail, add `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), accept `POST` with 200/202, honour within 48 h. "Gmail and Yahoo require RFC 8058 compliance for bulk senders (those sending more than 5,000 messages per day to their domains)."
  Sources: https://resend.com/docs/knowledge-base/should-i-add-an-unsubscribe-link · https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails
- **Tags:** key/value, ASCII letters/digits/`_`/`-`, ≤256 chars each, "up to 75 tags per email"; "After the email is sent, the tag is included in the webhook event." Example use: category like "welcome" or "password reset", customer ID.
  Source: https://resend.com/docs/dashboard/emails/tags
- **Batch vs Broadcasts:** "For marketing campaigns, use our no-code editor, Broadcasts, instead." (batch is positioned for transactional mail).
  Source: https://resend.com/docs/dashboard/emails/batch-sending

## 8. Scheduled sending (`scheduledAt`)

- `scheduledAt` (SDK) / `scheduled_at` (API): natural language ("in 1 hour", "tomorrow at 9am") or ISO 8601. "Emails can be scheduled up to 30 days in advance." Works on `/emails` and per email in `/emails/batch`. Scheduled mail can be updated or cancelled ("Once an email is canceled, it cannot be rescheduled"). SMTP cannot schedule. An `email.scheduled` webhook fires.
  Sources: https://resend.com/docs/dashboard/emails/schedule-email · https://resend.com/docs/api-reference/emails/send-email
- Resend frames it for mail that can wait: "While some emails need to be delivered as soon as possible, like password resets or magic links, others can be scheduled."
  Source: https://resend.com/docs/dashboard/emails/schedule-email
- **Does it help spread a blast?** Staggering `scheduled_at` values across emails does spread *delivery* over time, which is what the warm-up hourly caps ask for. It does **not** reduce API calls at submission: scheduling still costs one request per call (a batch of 100 scheduled emails is still one request).
  **UNVERIFIED:** whether scheduled emails count toward quota at scheduling time or at send time, and whether Resend itself paces a large number of emails scheduled for the same instant.

---

## 9. What this means for us (recommendations, not sourced facts)

> **Superseded in part (2026-09-16).** The decisions taken in #126 keep one root sender (`noreply@reservetoday.app`, no subdomains, item 7) and replace the invitation numbers in item 6 with the batch plan in [`email-deliverability-runbook.md`](email-deliverability-runbook.md). The recommendations below are kept as written at research time.

1. **Fix the rate-limit assumption.** Drop the hard-coded "2 req/s". Read `ratelimit-limit` / `ratelimit-remaining` / `retry-after` from the `headers` the SDK already returns (§5), and treat 10 req/s shared across *every key on the team* (§1) as the ceiling. If staging and production keys live on the same Resend team, they compete; put them on separate teams or budget for it.
2. **Replace per-send retry with one process-wide send queue.** A single in-process limiter in `resendTransport` (e.g. ≤ 8 req/s token bucket, leaving headroom) with two lanes: **priority** (member sign-in codes, staff 2FA) and **normal** (booking/purchase mail, admin notifications, invite blast). Priority always drains first. `emailEveryAdmin` then needs no special retry. Note this only covers one Node process; if the backend ever runs more than one instance, the limiter must move to Postgres or the budget must be split.
3. **Classify errors by `error.name`, not by status.**
   - `rate_limit_exceeded`, `application_error`, `service_unavailable`, `concurrent_idempotent_requests`, `resource_locked`, network errors (`statusCode: null`) → retry: wait `retry-after` seconds if present, else exponential backoff with jitter (1 s, 2 s, 4 s…, cap ~30 s). For sign-in codes cap total wait at a few seconds and fail fast so the member can press "resend"; for bulk mail retry longer, outside the HTTP request.
   - `daily_quota_exceeded`, `monthly_quota_exceeded` → **do not retry in-loop.** Stop the normal lane, log `email_log.status = 'failed'` with a distinct reason, alert the platform owner. Sign-in codes are then also blocked, so this is an outage-class alert. Also watch `x-resend-monthly-quota` and alert at e.g. 80% of plan.
   - Everything else (validation, auth, idempotency conflict, suspended key) → fail immediately and alert; retrying cannot help.
4. **Always send an idempotency key**, derived from our own row, e.g. `email-log/<email_log.id>` or `sign-in-code/<code id>`, generated once and reused on every retry. This makes retries after timeouts safe for 24 h. Keep keys well under 256 chars.
5. **Plan-check before cutover.** On Free, the 100/day quota cannot send 800 invites. On Pro there is no daily cap, but overages must be enabled or sending stops at the monthly quota.
6. **Invite blast to ~800 members: warm up, don't blast.** The domain is new and already hit Gmail spam, so follow Resend's new-domain table (§7): e.g. ≤150 invites on day 1, 250 day 2, 400 day 3, then the rest with an hourly cap, prioritising members most likely to engage (recently active). Use `resend.batch.send` with chunks well under 100 (e.g. 25–50 per call spread over the hour, or use per-email `scheduledAt` to stagger delivery), one idempotency key per chunk (`invite-cutover/<tenant>/chunk-<n>`), and record each returned `data[i].id` against the member in `email_log`. Run it from the normal lane so sign-in codes, which the invite itself generates demand for, are never starved. Decide on `batchValidation`: `permissive` lets one bad address not sink the chunk, but then the failed indexes must be retried under a *new* key (the old key returns the original response).
7. **Separate the reputation of auth codes from bulk.** Resend recommends subdomains per purpose (§7). Candidate layout: `auth.reservetoday.app` (or a single `notifications.` subdomain) for sign-in and 2FA codes; a different subdomain for invitations and any future studio announcements. Each subdomain needs its own verification and warm-up, so decide this before cutover, not after.
8. **Add a Resend webhook route** (`routes/webhooks/resend.ts`, alongside Stripe's): raw body + `resend.webhooks.verify`, dedupe on `svix-id`, handle `email.bounced` (Permanent), `email.complained`, `email.suppressed`, `email.failed`, `email.delivery_delayed`; update `email_log` by Resend `email_id`, and flag the member's address in the portal so staff can fix typos. Resend already auto-suppresses hard bounces and complaints, so the webhook is about visibility and not re-trying dead addresses. Watch bounce rate < 4% and complaint rate < 0.08% (the pause thresholds). Since Gmail does not send complaints, register the domain in Gmail Postmaster Tools. New env var (`RESEND_WEBHOOK_SECRET`) means updating `deploy-be.yml`, `.env.example`, `env.ts` together.
9. **Tag every message** (`type=sign_in_code|booking_confirmation|invite…`, `tenant=<slug>`) so webhook events can be mapped back without extra lookups. Tag values allow only ASCII letters, digits, `_`, `-`.
10. **Keep open/click tracking off** on the sending domain(s) (default off). Sign-in emails should carry the code in the body and link only to our own domain. Add `List-Unsubscribe` (+ one-click POST) to the invite and any future announcement mail; not needed on codes or receipts.

## Could not verify

- Our team's actual current rate limit and plan (dashboard only).
- Whether `retry-after` is present on quota-exceeded 429s.
- Exact semantics of `x-batch-validation: strict` vs `permissive` (SDK source only; not in the API reference).
- An explicit statement that each email in a batch counts one unit of quota (strongly implied, not stated).
- Whether scheduled emails consume quota at scheduling or send time, and how Resend paces many emails scheduled for the same moment.
- Whether a send to a suppressed address returns an API error or a 200 followed by `email.suppressed`.
- The rate-limit history: the 2023 changelog announced 10 req/s default; our code comment says 2 req/s. The docs today say 10. No primary source found explaining a period at 2 req/s.

## Sources

- https://resend.com/docs/api-reference/introduction
- https://resend.com/docs/api-reference/rate-limit
- https://resend.com/docs/api-reference/errors
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/api-reference/emails/send-batch-emails
- https://resend.com/docs/dashboard/emails/batch-sending
- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/docs/dashboard/emails/schedule-email
- https://resend.com/docs/dashboard/emails/tags
- https://resend.com/docs/dashboard/emails/email-suppressions
- https://resend.com/docs/dashboard/emails/email-bounces
- https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails
- https://resend.com/docs/dashboard/domains/tracking
- https://resend.com/docs/dashboard/webhooks/event-types
- https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/introduction
- https://resend.com/docs/webhooks/retries-and-replays
- https://resend.com/docs/knowledge-base/account-quotas-and-limits
- https://resend.com/docs/knowledge-base/warming-up
- https://resend.com/docs/knowledge-base/how-do-i-avoid-gmails-spam-folder
- https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain
- https://resend.com/docs/knowledge-base/how-do-i-maximize-deliverability-for-supabase-auth-emails
- https://resend.com/docs/knowledge-base/should-i-add-an-unsubscribe-link
- https://resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list
- https://resend.com/docs/llms.txt
- https://resend.com/pricing
- https://resend.com/changelog/api-rate-limit
- https://resend.com/blog/engineering-idempotency-keys (found, not read in full)
- https://github.com/resend/resend-node (`package.json`, `src/batch/interfaces/create-batch-options.interface.ts`) and installed `be/node_modules/resend/dist/index.mjs`, `index.d.mts` (v6.28.0)
- https://github.com/resend/email-best-practices (`references/sending-reliability.md`)
- https://github.com/resend/resend-skills (`skills/resend/references/sending/best-practices.md`)
