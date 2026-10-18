CREATE TYPE "public"."classpass_review_reason" AS ENUM('unparsed', 'unmapped_location', 'no_class', 'ambiguous_class', 'class_cancelled', 'client_deleted', 'already_booked');--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "review_reason" "classpass_review_reason";--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "reservation_id" text;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "class_name" text;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "member_name" text;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "member_email" text;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD CONSTRAINT "classpass_inbound_emails_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classpass_inbound_emails" ADD CONSTRAINT "classpass_inbound_emails_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classpass_inbound_emails_review_idx" ON "classpass_inbound_emails" USING btree ("tenant_id","review_reason") WHERE "classpass_inbound_emails"."review_reason" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classpass_inbound_emails_client_id_fk_idx" ON "classpass_inbound_emails" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "classpass_inbound_emails_booking_id_fk_idx" ON "classpass_inbound_emails" USING btree ("booking_id");--> statement-breakpoint
-- Hand-written (#411): a ClassPass booking that takes an Overbook seat emails
-- every Admin on classpass_overbooked. A studio's templates are written when it
-- is created (db/seed/email-templates.ts), so this gives the default to every
-- studio created before it, exactly as the seeder writes it today. An existing
-- row is never touched, and a second run changes nothing (as 0114).
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'classpass_overbooked', $new_subject$A ClassPass booking overbooked {{class_name}}$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A ClassPass booking overbooked a class</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{client_name}}</strong> booked <strong>{{class_name}}</strong> on <strong>{{date}}</strong> through ClassPass, after its online and buffer seats were all taken, so they hold an Overbook seat.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">ClassPass has already confirmed the booking with them. If the room cannot take one more, contact them through ClassPass.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="#1a2a7a" style="background:#1a2a7a;border-radius:8px;">
      <a href="{{classpass_url}}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid #0d1a5e;">Open the ClassPass page</a>
    </td>
  </tr>
</table>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;