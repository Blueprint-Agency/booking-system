-- The purchase confirmations state what the member paid (#370): the package,
-- trial pass and workshop confirmations gained an "Amount paid" row,
-- {{amount_paid}}, in their details table. A studio's templates are written once,
-- when it is created (db/seed/email-templates.ts), so this brings the row to the
-- studios created before it.
--
-- Only to a template nobody has edited. A row is updated when its subject and
-- body are byte-identical to the default it was written with: the shipped text
-- before #370, with this studio's name where that text names it (the trial
-- pass's subject, raw, and its heading, HTML-escaped as escapeHtml does). The
-- one tolerance is a trailing footer note (emailFooterNote): it is provisioning
-- data, not copy, and only the two isolation fixtures carry one. Anything else,
-- whether a studio's own wording, a template from an archive written by an
-- older release, or a studio renamed since its templates were written, is left
-- exactly as it is. The admin template editor answers 501 (#234), so today no
-- studio can have edited one; the check is for the day it can, and for
-- restored archives.
--
-- The update swaps the old details table for the new one and nothing else, so
-- an updated row is byte-identical to what the seed writes now. Idempotent: an
-- updated row no longer matches the old default, so a second run changes
-- nothing. Superuser, as every migration runs, so Row-Level Security does not
-- narrow it to one Tenant.
--
-- Data migration only (drizzle-kit generate --custom): no schema change, so its
-- snapshot is the previous one, which is correct.

-- package_purchase_confirmed
UPDATE email_templates AS et
SET body_html = replace(et.body_html, $old_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Package</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
</table>$old_details$, $new_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Package</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Amount paid</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{amount_paid}}</td>
  </tr>
</table>$new_details$),
    updated_at = now()
FROM tenants AS t
WHERE t.id = et.tenant_id
  AND et.slug = 'package_purchase_confirmed'
  AND et.subject = 'Your package is confirmed'
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = $old_0$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your package is confirmed</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Package</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{receipt_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your purchase →</a></p>$old_0$;
--> statement-breakpoint
-- trial_pass_purchase_confirmed
UPDATE email_templates AS et
SET body_html = replace(et.body_html, $old_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Your pass</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
</table>$old_details$, $new_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Your pass</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Amount paid</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{amount_paid}}</td>
  </tr>
</table>$new_details$),
    updated_at = now()
FROM tenants AS t
WHERE t.id = et.tenant_id
  AND et.slug = 'trial_pass_purchase_confirmed'
  AND et.subject = 'Welcome to ' || t.name
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = $old_0$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Welcome to $old_0$ || replace(replace(replace(replace(replace(t.name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;') || $old_1$</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Your pass</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{package_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Includes</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{contents_line}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Validity</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{validity_line}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Book your first class whenever you are ready. Arrive ten minutes early and someone will show you around.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{receipt_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your account →</a></p>$old_1$;
--> statement-breakpoint
-- workshop_purchase_confirmed
UPDATE email_templates AS et
SET body_html = replace(et.body_html, $old_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Workshop</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{workshop_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Starts</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
</table>$old_details$, $new_details$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Workshop</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{workshop_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Starts</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Amount paid</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{amount_paid}}</td>
  </tr>
</table>$new_details$),
    updated_at = now()
FROM tenants AS t
WHERE t.id = et.tenant_id
  AND et.slug = 'workshop_purchase_confirmed'
  AND et.subject = 'Your place at {{workshop_name}} is confirmed'
  AND regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') = $old_0$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your workshop place is confirmed</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border:1px solid #d6dae4;border-radius:8px;background:#eef0f7;border-collapse:separate;">
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Workshop</td>
    <td valign="top" style="padding:10px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{workshop_name}}</td>
  </tr>
  <tr>
    <td data-text="label" valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5a6174;width:30%;white-space:nowrap;">Starts</td>
    <td valign="top" style="padding:10px 16px;border-top:1px solid #d6dae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;font-weight:600;color:#0d1a3e;">{{date}}</td>
  </tr>
</table>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your check-in code is <strong>{{code}}</strong>.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="{{qr_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Show your QR code →</a><br /><a href="{{receipt_url}}" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your purchase</a></p>$old_0$;
