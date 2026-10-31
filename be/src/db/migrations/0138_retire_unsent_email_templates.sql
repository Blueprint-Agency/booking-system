-- Four email templates were seeded into every studio and never sent, and no
-- longer exist: `welcome` (nothing creates a member's account as a welcome),
-- `referral_credited` (referral credit is not built), `pt_session_declined`
-- (a private session request is never declined in the app: staff schedule it
-- or cancel it) and `workshop_waitlist_promoted` (a workshop has no waitlist
-- to promote from). They are no longer seeded (db/seed/email-copy.ts), so a
-- studio created before keeps four rows no sender reads and no switch can
-- reach; this takes them away, the studio's own edits to them included, since
-- nothing ever mailed those words.
--
-- Data only, so it does what rule 0 of the README allows: the build still
-- serving during the deploy never looks any of the four up (`TemplateSlug` has
-- none of them), and the build rolled back to does not either. No schema change, so
-- its snapshot is the previous one, which is correct.
--
-- Idempotent: a second run finds nothing to delete. Superuser, as every
-- migration runs, so Row-Level Security does not narrow it to one Tenant.
DELETE FROM email_templates WHERE slug IN ('welcome', 'referral_credited', 'pt_session_declined', 'workshop_waitlist_promoted');--> statement-breakpoint
DELETE FROM email_switches WHERE slug IN ('welcome', 'referral_credited', 'pt_session_declined', 'workshop_waitlist_promoted');
