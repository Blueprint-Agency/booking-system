ALTER TYPE "public"."auth_event_kind" ADD VALUE 'sessions_revoked';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'user_blocked';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'user_unblocked';--> statement-breakpoint
ALTER TYPE "public"."auth_event_kind" ADD VALUE 'invitation_resent';