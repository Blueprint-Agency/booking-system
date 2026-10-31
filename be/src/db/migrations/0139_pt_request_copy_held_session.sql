-- The private session request emails promised something false (issue #522,
-- PR #536 review). Both said no session is taken by a request: `pt_request_submitted`
-- "no session has been deducted yet" and `pt_request_expired` "Nothing was
-- deducted". Submitting a request debits the package at once
-- (services/pt-sessions/request.ts), and an expiry gives it back
-- (`pt_request_expiry_refund`), unless a Refund has Voided the package, which
-- takes nothing back. The default wording now says what is true:
--
--  - `pt_request_submitted`: "The session for this request is held from your
--    package until it is answered."
--  - `pt_request_expired`: the refund is a sentence of its own, `{{refund_line}}`
--    (the sessions returned, or nothing at all), composed per send.
--
-- A studio's templates are written once, when it is created
-- (db/seed/email-templates.ts), so this brings the wording to the studios
-- created before. As migrations 0105, 0108 and 0117 do, it writes a row only
-- where it is still exactly the default it was written with: subject and body
-- byte-identical to the text shipped in #536's base, with the one tolerance
-- those migrations have. The text baked the studio's member app origin into
-- its link; the origin is read back out of the row's own link and put into the
-- old text before comparing, so a row matches only if it is exactly the old
-- default for its own studio. A trailing footer note (emailFooterNote) is
-- provisioning data rather than copy, and is kept on the updated row. Anything
-- else, whether a studio's own wording or a subject it changed, is left
-- exactly as it is.
--
-- The new wording is byte-identical to what the seeder writes for a studio
-- created today, the studio's own origin put back in the link.
--
-- Rollback (migrations/README.md rule 0): a build from before this change
-- fills no `{{refund_line}}` for an expired request, and its renderer turns an
-- unknown variable into nothing, so for as long as such a build runs against
-- this data the expired email loses its refund sentence and says nothing about
-- the session. Nothing fails; the sentence comes back with the roll forward.
--
-- Idempotent: an updated row no longer matches the old default. Superuser, as
-- every migration runs, so Row-Level Security does not narrow it to one Tenant.
-- Data only, so its snapshot is the previous one, which is correct.

-- pt_request_submitted
WITH held AS (
  SELECT et.tenant_id,
         substring(et.body_html from 'href="(https?://[^/"]+)/account"') AS origin,
         regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') AS core,
         coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), '') AS footer
  FROM email_templates et
  WHERE et.slug = 'pt_request_submitted'
    AND et.subject = $old_subject_submitted$Your private session request was received$old_subject_submitted$
)
UPDATE email_templates AS et
SET body_html = replace($new_body_submitted$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session request was received</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">You asked <strong>{{instructor_name}}</strong> for a private session on <strong>{{starts_at}}</strong>.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Nothing is confirmed yet. The session for this request is held from your package until it is answered. Your account shows the request and its outcome once the instructor has answered.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="@@ORIGIN@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your requests →</a></p>$new_body_submitted$, '@@ORIGIN@@', h.origin) || h.footer,
    updated_at = now()
FROM held h
WHERE et.tenant_id = h.tenant_id
  AND et.slug = 'pt_request_submitted'
  AND h.origin IS NOT NULL
  AND h.core = replace($old_body_submitted$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session request was received</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">You asked <strong>{{instructor_name}}</strong> for a private session on <strong>{{starts_at}}</strong>.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Nothing is confirmed and no session has been deducted yet. Your account shows the request and its outcome once the instructor has answered.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;"><a href="@@ORIGIN@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">View your requests →</a></p>$old_body_submitted$, '@@ORIGIN@@', h.origin);--> statement-breakpoint
-- pt_request_expired
WITH held AS (
  SELECT et.tenant_id,
         substring(et.body_html from 'href="(https?://[^/"]+)/account"') AS origin,
         regexp_replace(et.body_html, '\n<p data-email-footer-note style="display:none;">[^<]*</p>$', '') AS core,
         coalesce(substring(et.body_html from '(\n<p data-email-footer-note style="display:none;">[^<]*</p>)$'), '') AS footer
  FROM email_templates et
  WHERE et.slug = 'pt_request_expired'
    AND et.subject = $old_subject_expired$Your private session request expired$old_subject_expired$
)
UPDATE email_templates AS et
SET body_html = replace($new_body_expired$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session request expired</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your request to <strong>{{instructor_name}}</strong> for <strong>{{starts_at}}</strong> was not answered in time, so it has expired.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">{{refund_line}} <a href="@@ORIGIN@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Request another time →</a></p>$new_body_expired$, '@@ORIGIN@@', h.origin) || h.footer,
    updated_at = now()
FROM held h
WHERE et.tenant_id = h.tenant_id
  AND et.slug = 'pt_request_expired'
  AND h.origin IS NOT NULL
  AND h.core = replace($old_body_expired$<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#0d1a3e;">Your private session request expired</h1>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Hi {{client_name}},</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Your request to <strong>{{instructor_name}}</strong> for <strong>{{starts_at}}</strong> was not answered in time, so it has expired.</p>
<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0d1a3e;">Nothing was deducted. <a href="@@ORIGIN@@/account" style="color:#1a2a7a;font-weight:600;text-decoration:underline;">Request another time →</a></p>$old_body_expired$, '@@ORIGIN@@', h.origin);
