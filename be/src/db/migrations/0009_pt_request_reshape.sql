-- 0009_pt_request_reshape.sql
-- Reshape pt_requests for the simplified PT flow (no back-and-forth — all
-- negotiation happens on WhatsApp; admin schedules directly). See
-- docs/md/be-client.md §PT and docs/md/be-portal.md §PT for the spec.
--
-- IMPORTANT: this migration assumes the pt_requests / pt_sessions tables are
-- empty in every environment it runs against. The PT submit/schedule/cancel
-- backend paths are still stubbed (501) at the time this lands, so no real
-- pt_requests rows exist yet. The migration aborts up-front rather than
-- silently drop data if that assumption is wrong.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pt_requests) THEN
    RAISE EXCEPTION 'pt_requests is not empty — refusing to reshape; please hand-migrate before re-running 0009';
  END IF;
END $$;

-- 1. Drop the partial index whose predicate (WHERE status = 'pending') is
--    bound to the current enum type. If we leave it in place across the
--    type swap, Postgres can't revalidate the predicate against the new
--    pt_request_status and aborts the ALTER COLUMN. We recreate it at the
--    end of the migration once the new type is the column's type.
DROP INDEX IF EXISTS pt_requests_expires_at_pending_idx;
DROP INDEX IF EXISTS pt_requests_preferred_instructor_status_idx;

-- 2. pt_request_status enum: replace value set in place.
--    Postgres cannot DROP enum values, so we swap the type.
ALTER TYPE pt_request_status RENAME TO pt_request_status_old;

CREATE TYPE pt_request_status AS ENUM (
  'pending',
  'scheduled',
  'cancelled_before_scheduled',
  'cancelled_after_scheduled',
  'attended'
);

ALTER TABLE pt_requests
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE pt_request_status USING (
    CASE status::text
      WHEN 'pending'   THEN 'pending'
      WHEN 'scheduled' THEN 'scheduled'
      -- old terminal states all collapse to cancelled_before_scheduled — only
      -- reachable when this guarded migration is re-run after a manual data
      -- backfill, since the empty-table check above blocks the normal path.
      ELSE 'cancelled_before_scheduled'
    END::pt_request_status
  ),
  ALTER COLUMN status SET DEFAULT 'pending';

DROP TYPE pt_request_status_old;

-- 3. pt_requests structural changes.
ALTER TABLE pt_requests
  DROP CONSTRAINT IF EXISTS pt_requests_preferred_ends_after_starts;

ALTER TABLE pt_requests
  DROP COLUMN IF EXISTS preferred_instructor_id,
  DROP COLUMN IF EXISTS preferred_starts_at,
  DROP COLUMN IF EXISTS preferred_ends_at,
  DROP COLUMN IF EXISTS decline_note;

ALTER TABLE pt_requests
  ADD COLUMN class_type_id uuid NOT NULL REFERENCES class_types(id) ON DELETE RESTRICT,
  ADD COLUMN co_client_name text,
  ADD COLUMN co_client_email text;

CREATE INDEX pt_requests_class_type_idx ON pt_requests (class_type_id);

-- 4. Recreate the partial expiry index against the new enum type.
CREATE INDEX pt_requests_expires_at_pending_idx
  ON pt_requests (expires_at)
  WHERE status = 'pending';

-- 3. pt_request_slots child table — 1..N proposed date/time windows.
CREATE TABLE pt_request_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pt_request_id uuid NOT NULL REFERENCES pt_requests(id) ON DELETE CASCADE,
  proposed_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  CONSTRAINT pt_request_slots_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX pt_request_slots_request_idx ON pt_request_slots (pt_request_id);
