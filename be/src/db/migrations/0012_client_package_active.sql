-- 0012_client_package_active.sql
-- Every purchased package now carries an explicit `active` flag (the authoritative
-- consumability state) alongside expires_at. PT purchases previously had no expiry;
-- they now expire 365 days after purchase. pt_requests records which client_package
-- was debited so a cancel-while-pending can refund the exact package.
--
-- Hand-authored (matching 0008–0011): the migrator reads _journal.json + these .sql
-- files, not the meta snapshots (which stop at 0007).

-- 1. active flag — defaults true; existing rows get true, then corrected below.
ALTER TABLE client_packages
  ADD COLUMN active boolean NOT NULL DEFAULT true;

-- 2. Backfill PT expiry FIRST (so step 3 evaluates against the real expiry).
UPDATE client_packages
  SET expires_at = purchased_at + interval '365 days'
  WHERE kind = 'pt' AND expires_at IS NULL;

-- 3. Correct active to current reality: deactivate expired or exhausted packages.
UPDATE client_packages
  SET active = false
  WHERE (expires_at IS NOT NULL AND expires_at <= now())
     OR (kind <> 'unlimited' AND coalesce(credits_or_sessions_remaining, 0) <= 0);

-- 4. Record the debited package on a PT request (empty table today; route was 501).
ALTER TABLE pt_requests
  ADD COLUMN debited_client_package_id uuid REFERENCES client_packages(id) ON DELETE RESTRICT;
