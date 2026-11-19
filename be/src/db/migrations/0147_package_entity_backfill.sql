-- Package Entities (#556, spec #554): every catalogue package that exists when
-- this runs goes into its studio's first Entity. 0146 added the nullable
-- `entity_id` columns; this is their backfill, and it changes no schema, so its
-- snapshot is the previous one, which is correct (src/db/migrations/README.md
-- rule 3). The columns stay nullable this deploy (rule 0); the services and the
-- admin routes are what make a package's Entity required, and "NOT NULL" is a
-- later deploy's contract step.
--
-- "First" is the studio's first live Entity by display order, which for every
-- studio that existed before Entities is the "All classes" 0143 gave it. A
-- package that already has an Entity is left alone, so a second run changes
-- nothing. Superuser, as every migration runs, so Row-Level Security does not
-- narrow it to one Tenant.
--
-- A package a member holds has no column of its own: it reads its Entity through
-- the catalogue package it came from (`source_class_package_id` or
-- `source_pt_package_id`), so it moves with that package. One held with neither
-- source has nothing to read; those are counted per studio in the notice below,
-- and they keep working as before (an Entity is only a restriction when both
-- sides name one).
UPDATE class_packages p
SET entity_id = (
  SELECT e.id FROM entities e
  WHERE e.tenant_id = p.tenant_id AND e.archived_at IS NULL
  ORDER BY e.position, e.created_at, e.id
  LIMIT 1
)
WHERE p.entity_id IS NULL;--> statement-breakpoint
UPDATE pt_packages p
SET entity_id = (
  SELECT e.id FROM entities e
  WHERE e.tenant_id = p.tenant_id AND e.archived_at IS NULL
  ORDER BY e.position, e.created_at, e.id
  LIMIT 1
)
WHERE p.entity_id IS NULL;--> statement-breakpoint
UPDATE corporate_packages p
SET entity_id = (
  SELECT e.id FROM entities e
  WHERE e.tenant_id = p.tenant_id AND e.archived_at IS NULL
  ORDER BY e.position, e.created_at, e.id
  LIMIT 1
)
WHERE p.entity_id IS NULL;--> statement-breakpoint
DO $$
DECLARE
  orphan RECORD;
BEGIN
  FOR orphan IN
    SELECT tenant_id, count(*) AS held
    FROM client_packages
    WHERE source_class_package_id IS NULL AND source_pt_package_id IS NULL
    GROUP BY tenant_id
  LOOP
    RAISE NOTICE 'tenant % holds % package(s) with no catalogue source, which read no Entity', orphan.tenant_id, orphan.held;
  END LOOP;
END
$$;
