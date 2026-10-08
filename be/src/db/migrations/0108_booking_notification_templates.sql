-- The booking and cancellation emails are sent (#359: NTF-08, NTF-09, NTF-10,
-- NTF-11, NTF-18), and their default wording changed to say what they now
-- have to: the credits a booking used and what remains (class_booking_confirmed),
-- what a cancellation returned (class_cancelled_credit_returned,
-- pt_cancelled_session_returned, admin_cancel_class, admin_cancel_pt), the
-- amount paid in the shared money form, with no refund wording for a place that
-- was free (admin_cancel_workshop), and a check-in
-- nag the Admins are copied on (checkin_nag). PT Requests gained an email of
-- their own (pt_request_cancelled). A studio's templates are written once, when
-- it is created (db/seed/email-templates.ts), so this brings the new wording to
-- the studios created before it.
--
-- Two steps per template, both idempotent:
--
--  1. UPDATE a row only where it is still the default it was written with:
--     subject and body byte-identical to the shipped text before #359, as
--     migration 0105 compares them. That text baked the studio's member or
--     portal origin into one link; the origin is read back out of the row's
--     own link and put into the old text before comparing, so a row matches
--     only if it is exactly the old default for its own studio. The one
--     tolerance is 0105's: a trailing footer note (emailFooterNote), which is
--     provisioning data rather than copy, carried only by the two isolation
--     fixtures — and kept on the updated row. Anything else, whether a
--     studio's own wording or text written by an older release, is left
--     exactly as it is. The admin template editor answers 501 (#234), so today
--     no studio can have edited one; the check is for the day it can, and for
--     restored archives.
--  2. INSERT the new default for every studio that has no row for the slug
--     (pt_request_cancelled everywhere; any other slug a restored archive
--     lacked). An existing row is never touched by this step.
--
-- The new wording names no origin and no studio — its links are variables
-- built per send — so the text written here is byte-identical to what the
-- seeder writes for a studio created today (without a footer note, which only
-- the fixtures have). A second run changes nothing: an updated row no longer
-- matches the old default, and every slug then has a row. Superuser, as every
-- migration runs, so Row-Level Security does not narrow it to one Tenant.
--
-- Data migration only (hand-written custom migration): no schema change, so
-- its snapshot is the previous one, which is correct.

-- class_booking_confirmed
UPDATE email_templates AS et
SET subject = $new_subject${{class_name}} on {{date}} is booked$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your class is booked</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Class</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{class_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">When</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">With</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{instructor_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Where</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{location}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your check-in code is <strong>{{code}}</strong>. Show it at the studio, or open the QR code below.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{qr_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Show your QR code →</a></p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#5a6174;">{{credits_line}}</p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'class_booking_confirmed'
  AND et.subject = $old_subject${{class_name}} on {{date}} is booked$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = $old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your class is booked</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Class</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{class_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">When</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">With</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{instructor_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Where</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{location}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your check-in code is <strong>{{code}}</strong>. Show it at the studio, or open the QR code below.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{qr_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Show your QR code →</a></p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#5a6174;">Credits remaining: <strong>{{credits_remaining}}</strong>.</p>$old_body$;
--> statement-breakpoint
-- class_cancelled_credit_returned
UPDATE email_templates AS et
SET subject = $new_subject$Your class was cancelled — credit returned$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your booking is cancelled — credit returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{classes_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another class →</a></p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'class_cancelled_credit_returned'
  AND et.subject = $old_subject$Your class was cancelled — credit returned$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your booking is cancelled — credit returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{credits_returned}}</strong> credit(s) are back in your account, ready for another class.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="@@CLIENT@@/classes" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another class →</a></p>$old_body$, '@@CLIENT@@', coalesce(substring(et.body_html from 'href="([^"]*)/classes"'), '@@CLIENT@@'));
--> statement-breakpoint
-- pt_cancelled_session_returned
UPDATE email_templates AS et
SET subject = $new_subject$Your private session was cancelled — session returned$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session is cancelled — session returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}} <a href="{{account_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another session →</a></p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'pt_cancelled_session_returned'
  AND et.subject = $old_subject$Your private session was cancelled — session returned$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session is cancelled — session returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The session is back in your account and can be used for another booking. <a href="@@CLIENT@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another session →</a></p>$old_body$, '@@CLIENT@@', coalesce(substring(et.body_html from 'href="([^"]*)/account"'), '@@CLIENT@@'));
--> statement-breakpoint
-- admin_cancel_class
UPDATE email_templates AS et
SET subject = $new_subject${{class_name}} on {{date}} was cancelled$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A class has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{classes_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Find another class →</a></p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'admin_cancel_class'
  AND et.subject = $old_subject${{class_name}} on {{date}} was cancelled$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A class has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{credits_returned}}</strong> credit(s) have been returned to your account — nothing was charged for the cancelled class.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="@@CLIENT@@/classes" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Find another class →</a></p>$old_body$, '@@CLIENT@@', coalesce(substring(et.body_html from 'href="([^"]*)/classes"'), '@@CLIENT@@'));
--> statement-breakpoint
-- admin_cancel_pt
UPDATE email_templates AS et
SET subject = $new_subject$Your private session on {{starts_at}} was cancelled$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A private session has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}} <a href="{{account_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another time →</a></p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'admin_cancel_pt'
  AND et.subject = $old_subject$Your private session on {{starts_at}} was cancelled$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A private session has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The session is back in your account. <a href="@@CLIENT@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another time →</a></p>$old_body$, '@@CLIENT@@', coalesce(substring(et.body_html from 'href="([^"]*)/account"'), '@@CLIENT@@'));
--> statement-breakpoint
-- admin_cancel_workshop
UPDATE email_templates AS et
SET subject = $new_subject${{workshop_name}} was cancelled$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A workshop has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{workshop_name}}</strong>. We are sorry — we know a workshop is a date people plan around.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{workshops_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">See upcoming workshops →</a></p>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'admin_cancel_workshop'
  AND et.subject = $old_subject${{workshop_name}} was cancelled$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A workshop has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{workshop_name}}</strong>. We are sorry — we know a workshop is a date people plan around.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">You paid <strong>SGD {{refund_sgd}}</strong> for your place. The studio is arranging your refund and will contact you to settle it.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="@@CLIENT@@/workshops" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">See upcoming workshops →</a></p>$old_body$, '@@CLIENT@@', coalesce(substring(et.body_html from 'href="([^"]*)/workshops"'), '@@CLIENT@@'));
--> statement-breakpoint
-- checkin_nag
UPDATE email_templates AS et
SET subject = $new_subject$Check-in is still open for {{session_label}}$new_subject$,
    body_html = $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Check-in is still open for {{session_label}}</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{session_label}}</strong> on <strong>{{date}}</strong>, taught by <strong>{{instructor_name}}</strong>, ended more than a day ago, and <strong>{{pending_count}}</strong> member(s) on it are still unmarked.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Attendance drives credits and payroll, so it needs to be right. It takes a moment at the check-in desk — mark who came and who did not.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="#1a2a7a" style="background:#1a2a7a;border-radius:8px;">
      <a href="{{checkin_url}}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid #0d1a5e;">Open the check-in desk</a>
    </td>
  </tr>
</table>$new_body$ || coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), ''),
    updated_at = now()
WHERE et.slug = 'checkin_nag'
  AND et.subject = $old_subject$Check-in is still open for {{session_label}}$old_subject$
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = replace($old_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Check-in is still open for {{session_label}}</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{instructor_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{pending_count}}</strong> member(s) on <strong>{{session_label}}</strong> are still unmarked. Attendance drives credits and payroll, so it needs to be right.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">It takes a moment in the portal — mark who came and who did not.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="#1a2a7a" style="background:#1a2a7a;border-radius:8px;">
      <a href="@@PORTAL@@/instructor/classes" target="_blank" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid #0d1a5e;">Complete check-in</a>
    </td>
  </tr>
</table>$old_body$, '@@PORTAL@@', coalesce(substring(et.body_html from 'href="([^"]*)/instructor/classes"'), '@@PORTAL@@'));
--> statement-breakpoint
-- class_booking_confirmed: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'class_booking_confirmed', $new_subject${{class_name}} on {{date}} is booked$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your class is booked</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Class</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{class_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">When</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">With</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{instructor_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Where</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{location}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your check-in code is <strong>{{code}}</strong>. Show it at the studio, or open the QR code below.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{qr_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Show your QR code →</a></p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#5a6174;">{{credits_line}}</p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- class_cancelled_credit_returned: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'class_cancelled_credit_returned', $new_subject$Your class was cancelled — credit returned$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your booking is cancelled — credit returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your booking for <strong>{{class_name}}</strong> on <strong>{{date}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{classes_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another class →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- pt_request_cancelled: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'pt_request_cancelled', $new_subject${{session_line}} was cancelled$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session is cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{session_line}}</strong> has been cancelled. {{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">You can ask for another time whenever you like. <a href="{{account_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your private sessions →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- pt_cancelled_session_returned: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'pt_cancelled_session_returned', $new_subject$Your private session was cancelled — session returned$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session is cancelled — session returned</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong> has been cancelled.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}} <a href="{{account_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another session →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- admin_cancel_class: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'admin_cancel_class', $new_subject${{class_name}} on {{date}} was cancelled$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A class has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{class_name}}</strong> on <strong>{{date}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{classes_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Find another class →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- admin_cancel_pt: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'admin_cancel_pt', $new_subject$Your private session on {{starts_at}} was cancelled$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A private session has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled your private session with <strong>{{instructor_name}}</strong> on <strong>{{starts_at}}</strong>. We are sorry for the change of plan.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}} <a href="{{account_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Book another time →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- admin_cancel_workshop: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'admin_cancel_workshop', $new_subject${{workshop_name}} was cancelled$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">A workshop has been cancelled</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">The studio has cancelled <strong>{{workshop_name}}</strong>. We are sorry — we know a workshop is a date people plan around.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}}</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{workshops_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">See upcoming workshops →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
--> statement-breakpoint
-- checkin_nag: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'checkin_nag', $new_subject$Check-in is still open for {{session_label}}$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Check-in is still open for {{session_label}}</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><strong>{{session_label}}</strong> on <strong>{{date}}</strong>, taught by <strong>{{instructor_name}}</strong>, ended more than a day ago, and <strong>{{pending_count}}</strong> member(s) on it are still unmarked.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Attendance drives credits and payroll, so it needs to be right. It takes a moment at the check-in desk — mark who came and who did not.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="#1a2a7a" style="background:#1a2a7a;border-radius:8px;">
      <a href="{{checkin_url}}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid #0d1a5e;">Open the check-in desk</a>
    </td>
  </tr>
</table>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
