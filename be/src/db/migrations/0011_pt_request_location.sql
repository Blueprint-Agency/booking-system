-- 0011_pt_request_location.sql
-- PT requests now carry the studio location the client wants the session at,
-- captured at request time. The portal filters pending requests by the staff's
-- active workspace location. Previously location was only chosen at scheduling
-- time (on pt_sessions).
-- See docs/md/be-client.md §PT and docs/md/be-portal.md §PT.
--
-- Hand-authored (matching 0008/0009/0010): the migrator reads _journal.json +
-- these .sql files, not the meta snapshots (which stop at 0007).
--
-- pt_requests is empty in every environment (the client POST /request route is
-- still 501), so adding a NOT NULL column without a backfill is safe.

ALTER TABLE pt_requests
  ADD COLUMN location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT;

-- Backs the portal's location-scoped pending-request list.
CREATE INDEX pt_requests_location_status_idx ON pt_requests (location_id, status);
