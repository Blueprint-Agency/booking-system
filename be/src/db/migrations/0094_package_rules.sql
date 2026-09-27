CREATE TYPE "public"."package_rule_mode" AS ENUM('all', 'only', 'except');--> statement-breakpoint
CREATE TABLE "class_rule_packages" (
	"tenant_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"class_package_id" uuid NOT NULL,
	CONSTRAINT "class_rule_packages_class_id_class_package_id_pk" PRIMARY KEY("class_id","class_package_id")
);
--> statement-breakpoint
CREATE TABLE "class_series_rule_packages" (
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"class_package_id" uuid NOT NULL,
	CONSTRAINT "class_series_rule_packages_series_id_class_package_id_pk" PRIMARY KEY("series_id","class_package_id")
);
--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "package_rule_mode" "package_rule_mode" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "package_rule_mode" "package_rule_mode" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "class_rule_packages" ADD CONSTRAINT "class_rule_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_rule_packages" ADD CONSTRAINT "class_rule_packages_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_rule_packages" ADD CONSTRAINT "class_rule_packages_class_package_id_class_packages_id_fk" FOREIGN KEY ("class_package_id") REFERENCES "public"."class_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_rule_packages" ADD CONSTRAINT "class_series_rule_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_rule_packages" ADD CONSTRAINT "class_series_rule_packages_series_id_class_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."class_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_rule_packages" ADD CONSTRAINT "class_series_rule_packages_class_package_id_class_packages_id_fk" FOREIGN KEY ("class_package_id") REFERENCES "public"."class_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_rule_packages_class_package_id_fk_idx" ON "class_rule_packages" USING btree ("class_package_id");--> statement-breakpoint
CREATE INDEX "class_rule_packages_package_idx" ON "class_rule_packages" USING btree ("tenant_id","class_package_id");--> statement-breakpoint
CREATE INDEX "class_series_rule_packages_class_package_id_fk_idx" ON "class_series_rule_packages" USING btree ("class_package_id");--> statement-breakpoint
CREATE INDEX "class_series_rule_packages_package_idx" ON "class_series_rule_packages" USING btree ("tenant_id","class_package_id");--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migration 0086 does: the sweep is what
-- guarantees it, this is what makes a database that has only had `db:migrate`
-- run against it correct from the moment the tables exist. Same predicate as
-- migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "class_rule_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_rule_packages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "class_rule_packages";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "class_rule_packages"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "class_series_rule_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_series_rule_packages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "class_series_rule_packages";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "class_series_rule_packages"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);