CREATE TYPE "public"."pt_request_origin" AS ENUM('member', 'portal');--> statement-breakpoint
ALTER TABLE "pt_requests" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "origin" "pt_request_origin" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "created_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pt_requests_created_by_staff_id_fk_idx" ON "pt_requests" USING btree ("created_by_staff_id");