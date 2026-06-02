-- 0010_corporate_requests.sql
-- Corporate goes request-driven (mirrors the PT request flow). A member buys a
-- corporate package in fe-client → one corporate_requests row is auto-created
-- (pending) → admin schedules it into a corporate_session (the implicit approval).
-- See docs/md/be-client.md §Corporate and docs/md/be-portal.md §Corporate.
--
-- Hand-authored (matching 0008/0009): the migrator reads _journal.json + these
-- .sql files, not the meta snapshots (which stop at 0007).

-- 1. New enum for corporate request lifecycle.
CREATE TYPE corporate_request_status AS ENUM (
  'pending',
  'scheduled',
  'cancelled',
  'attended'
);

-- 2. stripe_payment_kind gains 'corporate_package' so the webhook can record the
--    purchase in the ledger. (Not used in this transaction — safe on PG 12+.)
ALTER TYPE stripe_payment_kind ADD VALUE IF NOT EXISTS 'corporate_package';

-- 3. Back-link column on corporate_sessions (nullable — legacy/ad-hoc sessions
--    predate the request flow). The circular FK is added at the end.
ALTER TABLE corporate_sessions
  ADD COLUMN corporate_request_id uuid;

-- 4. corporate_requests — one per purchased corporate package.
CREATE TABLE corporate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  corporate_package_id uuid NOT NULL REFERENCES corporate_packages(id) ON DELETE RESTRICT,
  status corporate_request_status NOT NULL DEFAULT 'pending',
  message text,
  -- circular FK to corporate_sessions(id) added below.
  scheduled_corporate_session_id uuid,
  resolved_at timestamptz,
  resolved_by_staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX corporate_requests_status_created_idx ON corporate_requests (status, created_at);
CREATE INDEX corporate_requests_client_status_idx ON corporate_requests (client_id, status);

-- 5. The two circular FKs between corporate_requests and corporate_sessions.
--    DEFERRABLE INITIALLY DEFERRED lets scheduleCorporateRequest() insert the
--    session and update the request's scheduled_corporate_session_id in one txn.
ALTER TABLE corporate_requests
  ADD CONSTRAINT corporate_requests_scheduled_corporate_session_fk
  FOREIGN KEY (scheduled_corporate_session_id) REFERENCES corporate_sessions(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE corporate_sessions
  ADD CONSTRAINT corporate_sessions_corporate_request_fk
  FOREIGN KEY (corporate_request_id) REFERENCES corporate_requests(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
