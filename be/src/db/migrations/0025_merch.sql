ALTER TYPE "public"."stripe_payment_kind" ADD VALUE 'merch';--> statement-breakpoint
CREATE TABLE "merch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_sgd" numeric(10, 2) NOT NULL,
	"image_r2_key" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merch_price_non_negative" CHECK ("merch"."price_sgd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merch_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"merch_id" uuid,
	"title" text NOT NULL,
	"amount_sgd" numeric(10, 2) NOT NULL,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merch_orders" ADD CONSTRAINT "merch_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_orders" ADD CONSTRAINT "merch_orders_merch_id_merch_id_fk" FOREIGN KEY ("merch_id") REFERENCES "public"."merch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merch_archived_idx" ON "merch" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "merch_orders_client_created_idx" ON "merch_orders" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merch_orders_intent_unique" ON "merch_orders" USING btree ("stripe_payment_intent_id");