-- A studio archive's restore, as a job the server runs and the page reads back.
--
-- The import used to be one request: upload, write every row, answer with the
-- summary. A reload or a closed tab lost the only record of how it went, and
-- nothing existed to draw a progress bar from. This table is that record — see
-- `tenantImports` in src/db/schema/tenancy.ts and
-- src/services/tenants/import-jobs.ts.
--
-- Tenant-scoped (`tenant_id NOT NULL`) and policed like every other such table,
-- but not studio data: `tenantTableOrder` leaves it out of the archive and of
-- the import's emptiness check, and it goes with the studio by ON DELETE CASCADE.
--
-- Schema change: needs review by both backend devs.
CREATE TABLE "tenant_imports" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"phase" text DEFAULT 'uploading' NOT NULL,
	"file_name" text NOT NULL,
	"upload_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"total" integer,
	"summary" jsonb,
	"error_code" text,
	"error" text,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "tenant_imports_status_valid" CHECK ("tenant_imports"."status" IN ('uploading', 'processing', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "tenant_imports" ADD CONSTRAINT "tenant_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_imports_one_running" ON "tenant_imports" USING btree ("tenant_id") WHERE status IN ('uploading', 'processing');--> statement-breakpoint
CREATE INDEX "tenant_imports_tenant_created_idx" ON "tenant_imports" USING btree ("tenant_id","created_at");--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts): the sweep is what guarantees it, this is
-- what makes a database that has only had `db:migrate` run against it correct
-- from the moment the table exists. Same predicate as migration 0033 (and
-- 0070); FORCE so the owner is subject to it too.
ALTER TABLE "tenant_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_imports";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_imports"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);