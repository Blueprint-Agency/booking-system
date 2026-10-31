-- A request names the session it was scheduled as, and now the database holds it
-- to a session that exists. Nothing ever added the foreign key, so a request can
-- already name an id that is no session. Adding the constraint would refuse the
-- whole migration over such a row, so those ids are cleared first: every reader
-- (the member's list, the cancel, the unseen-approval count) already treats a
-- request whose session is not found as one with no session, so clearing the id
-- changes nothing anyone sees. The request keeps its row, its status and its
-- debit. Each cleared id is printed as a NOTICE (request, studio, status, the id
-- it named) so the deploy log keeps what the column no longer does.
--
-- `pt_requests` is under forced Row-Level Security. A migration role that
-- bypasses it (the superuser the deploy migrates as) sees every studio's rows;
-- one that does not would see none, and the UPDATE would silently clear
-- nothing before the key refused the rest. With `row_security = off` such a
-- role fails here instead, loudly.
SET LOCAL row_security = off;
--> statement-breakpoint
DO $$
DECLARE
  "cleared" record;
BEGIN
  FOR "cleared" IN
    UPDATE "pt_requests" AS "r"
    SET "scheduled_pt_session_id" = NULL
    FROM (
      SELECT "id", "scheduled_pt_session_id" AS "gone" FROM "pt_requests"
    ) AS "before"
    WHERE "before"."id" = "r"."id"
      AND "before"."gone" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "pt_sessions" AS "s" WHERE "s"."id" = "before"."gone")
    RETURNING "r"."id", "r"."tenant_id", "r"."status", "before"."gone"
  LOOP
    RAISE NOTICE 'pt_requests % (studio %, status %) named pt_session % which does not exist; cleared',
      "cleared"."id", "cleared"."tenant_id", "cleared"."status", "cleared"."gone";
  END LOOP;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE "conname" = 'pt_requests_scheduled_pt_session_id_pt_sessions_id_fk'
      AND "conrelid" = 'public.pt_requests'::regclass
  ) THEN
    ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_scheduled_pt_session_id_pt_sessions_id_fk" FOREIGN KEY ("scheduled_pt_session_id") REFERENCES "public"."pt_sessions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pt_requests_scheduled_pt_session_id_fk_idx" ON "pt_requests" USING btree ("scheduled_pt_session_id");
