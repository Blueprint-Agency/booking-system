-- The Cancellation Cap can be switched off (#318). Every existing studio keeps
-- the cap it has — the column arrives `true` — and keeps its configured count;
-- only a studio created from here on starts at 10 per 30 days, and that is the
-- provisioning code's doing, not this migration's.
ALTER TABLE "global_policy" ADD COLUMN "cancel_cap_enabled" boolean DEFAULT true NOT NULL;
