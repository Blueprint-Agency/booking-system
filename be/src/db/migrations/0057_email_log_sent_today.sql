-- How much of Resend Free's daily cap has the platform used?
--
-- The cap is 100 emails a day for the whole Resend team, counted per UTC
-- calendar day, and every studio's mail draws on it. Past it, sign-in codes
-- stop along with everything else, so the send gate (src/lib/send-gate.ts)
-- warns at 80. It needs a count across every tenant, and the application role
-- sees at most one tenant's `email_log` under the policies from 0033.
--
-- So: the shape 0041 uses. One owner-owned SECURITY DEFINER function answering
-- one narrow question — a single number, never a row — with src/lib/mailer.ts
-- as its only caller.
--
-- Counted by `sent_at`, not by `status`: since 0056 a sent row moves on to
-- delivered, bounced, complained, delivery_delayed or suppressed when Resend's
-- webhook reports its outcome (#154), and every one of those still used a slot
-- of the daily cap. `sent_at` is written only when Resend accepted the message
-- and is never cleared; a queued or failed row has none.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.email_log_sent_today()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM email_log
  WHERE sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.email_log_sent_today() FROM PUBLIC;
