CREATE TYPE "public"."classpass_email_kind" AS ENUM('booking', 'cancellation', 'roster', 'marketing', 'gmail_confirmation', 'other');--> statement-breakpoint
CREATE TYPE "public"."classpass_email_outcome" AS ENUM('imported', 'cancelled', 'noop', 'ignored', 'refused', 'unparsed', 'review');--> statement-breakpoint
CREATE TABLE "classpass_inbound_emails" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"kind" "classpass_email_kind" NOT NULL,
	"outcome" "classpass_email_outcome" NOT NULL,
	"authentication" jsonb,
	"headers" jsonb,
	"text" text,
	"html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classpass_settings" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address_token" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"gmail_confirmation_code" text,
	"gmail_confirmation_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD CONSTRAINT "classpass_inbound_emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classpass_settings" ADD CONSTRAINT "classpass_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classpass_inbound_emails_message_unique" ON "classpass_inbound_emails" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE INDEX "classpass_inbound_emails_received_idx" ON "classpass_inbound_emails" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "classpass_settings_tenant_unique" ON "classpass_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classpass_settings_address_token_unique" ON "classpass_settings" USING btree ("address_token");--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migrations 0103, 0112 and 0116 do. Same
-- predicate as migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "classpass_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "classpass_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "classpass_settings";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "classpass_settings"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "classpass_inbound_emails";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "classpass_inbound_emails"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Which Tenant is this ClassPass address?
--
-- Resend calls the one inbound webhook, on a hostname that carries no Tenant,
-- for mail sent to `<token>@<inbound domain>`. The token is the routing key and
-- lives on `classpass_settings`, which the policies above hide from a caller
-- with no Tenant context. So, as migration 0034 does for payment webhooks, an
-- owner-owned SECURITY DEFINER function answers "whose address is this?" and
-- returns a tenant id and nothing else. A regenerated token is no longer in the
-- table, so the old address answers NULL.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.tenant_for_classpass_token(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM classpass_settings WHERE address_token = p_token
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_for_classpass_token(text) FROM PUBLIC;