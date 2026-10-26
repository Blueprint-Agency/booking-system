ALTER TYPE "public"."staff_update_kind" ADD VALUE 'session_changed';--> statement-breakpoint
ALTER TYPE "public"."staff_update_kind" ADD VALUE 'session_cancelled_by_admin';--> statement-breakpoint
ALTER TYPE "public"."staff_update_kind" ADD VALUE 'pt_session_cancelled_by_member';