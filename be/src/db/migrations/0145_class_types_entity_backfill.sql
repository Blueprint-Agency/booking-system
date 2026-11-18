-- Class Types belong to an Entity (#557, spec #554): every Class Type that exists
-- when this runs is put in its studio's first live Entity, which 0143 made
-- ("All classes"). 0144 added the column nullable (src/db/migrations/README.md
-- rule 0); this is its backfill, and it changes no schema, so its snapshot is the
-- previous one, which is correct (rule 3). Making the column NOT NULL is a later
-- deploy.
--
-- Every row, sub-types and archived or deleted ones too: a sub-type stores its
-- parent's Entity and an archived type is only hidden, not gone. Every Class Type
-- of a studio lands in the same Entity, so a sub-type equals its parent by
-- construction.
--
-- Only a row with no Entity is touched, so a second run changes nothing, and a
-- studio that has none (a studio created after 0143 always has one) is skipped.
-- Superuser, as every migration runs, so Row-Level Security does not narrow it to
-- one Tenant.
UPDATE class_types ct
SET entity_id = (
  SELECT e.id
  FROM entities e
  WHERE e.tenant_id = ct.tenant_id AND e.archived_at IS NULL
  ORDER BY e.position, e.created_at, e.id
  LIMIT 1
)
WHERE ct.entity_id IS NULL;
