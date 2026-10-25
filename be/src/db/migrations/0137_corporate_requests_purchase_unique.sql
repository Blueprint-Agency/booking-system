-- One Corporate Request per Purchase. Where several already name one, the
-- request furthest along keeps it: that is the one the studio delivered or
-- arranged, and the one a Refund of the Purchase must reach. The others keep
-- their rows, status and sessions and only stop naming the Purchase: a
-- duplicate may stand for a second payment, so whether it is owed is a
-- person's call, not this migration's.
UPDATE "corporate_requests" AS "r"
SET "purchase_id" = NULL
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "tenant_id", "purchase_id"
    ORDER BY
      CASE "status" WHEN 'attended' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
      "created_at",
      "id"
  ) AS "rank"
  FROM "corporate_requests"
  WHERE "purchase_id" IS NOT NULL
) AS "ranked"
WHERE "r"."id" = "ranked"."id" AND "ranked"."rank" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "corporate_requests_purchase_unique" ON "corporate_requests" USING btree ("tenant_id","purchase_id") WHERE "corporate_requests"."purchase_id" IS NOT NULL;
