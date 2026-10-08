-- A paid corporate package is confirmed by email (#359, be-client § Corporate
-- branch step 5): the webhook sends corporate_purchase_confirmed once the
-- delivery that made the Corporate Request has committed. A studio's templates
-- are written once, when it is created (db/seed/email-templates.ts), so this
-- gives the template to the studios created before it. Without the row the send
-- fails, is reported, and the member gets no confirmation.
--
-- INSERT the default for every studio that has no row for the slug. An existing
-- row is never touched (ON CONFLICT DO NOTHING on the (tenant_id, slug) key),
-- whether it is the default or a studio's own wording. A second run changes
-- nothing: every studio then has a row.
--
-- The wording names no origin and no studio — its one link is a variable built
-- per send — so the text written here is byte-identical to what the seeder
-- writes for a studio created today (without a footer note, which only the
-- isolation fixtures have, and they are given the template when they are
-- seeded). Superuser, as every migration runs, so Row-Level Security does not
-- narrow it to one Tenant.
--
-- Data migration only (hand-written custom migration): no schema change, so
-- its snapshot is the previous one, which is correct.

-- corporate_purchase_confirmed: any studio without one
INSERT INTO email_templates (tenant_id, slug, subject, body_html)
SELECT t.id, 'corporate_purchase_confirmed', $new_subject$Your corporate package is confirmed$new_subject$, $new_body$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your corporate package is confirmed</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Package</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Amount paid</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{amount_paid}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your request is with the studio. They will be in touch to arrange the date, time and venue with you.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{receipt_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your purchase →</a></p>$new_body$
FROM tenants AS t
ON CONFLICT (tenant_id, slug) DO NOTHING;
