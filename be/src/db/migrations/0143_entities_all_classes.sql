-- Entities (#555, spec #554): every studio that exists when this runs gets one
-- Entity, "All classes", so a studio always has at least one. 0142 made the
-- table; this is its backfill, and it changes no schema, so its snapshot is the
-- previous one, which is correct (src/db/migrations/README.md rule 3).
--
-- "All classes" is a generic default, not a studio's name: the studio renames it
-- from settings when it adds a second line. A studio created after this gets the
-- same row from provisioning (services/tenants/provision.ts).
--
-- Only a studio with no Entity at all is given one, so a second run changes
-- nothing, and neither does a run on a studio that already has its own. Superuser,
-- as every migration runs, so Row-Level Security does not narrow it to one Tenant.
INSERT INTO entities (tenant_id, name, slug, position)
SELECT t.id, 'All classes', 'all-classes', 0
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.tenant_id = t.id);
