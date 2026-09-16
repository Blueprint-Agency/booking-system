-- Today's count keeps counting mail after Resend reports on it.
--
-- 0055 counted rows with `status = 'sent'`. Since 0056 a sent row moves on to
-- delivered, bounced, complained, delivery_delayed or suppressed when Resend's
-- webhook reports its outcome (#154) — and every one of those still used a slot
-- of the daily cap. Counting by status alone would let the count fall as mail
-- was delivered, and the send gate's 80-of-100 warning would arrive late.
--
-- `sent_at` is written only when Resend accepted the message and is never
-- cleared, so it is the honest test on its own. A queued or failed row has none.
--
-- Same function, same signature: the grant from src/db/roles.ts survives
-- CREATE OR REPLACE, and the REVOKE below is repeated only to keep the pair
-- together for a reader.
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
