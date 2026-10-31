-- `welcome` and `referral_credited` were seeded into every studio and never
-- sent: nothing creates a member's account as a welcome, and referral credit is
-- not built. They are no longer seeded (db/seed/email-copy.ts), so a studio
-- created before keeps two rows no sender reads and no switch can reach; this
-- takes them away, the studio's own edits to them included, since nothing ever
-- mailed those words.
--
-- Data only, so it does what rule 0 of the README allows: the build still
-- serving during the deploy never looks either row up (`TemplateSlug` has
-- neither), and the build rolled back to does not either. No schema change, so
-- its snapshot is the previous one, which is correct.
--
-- Idempotent: a second run finds nothing to delete. Superuser, as every
-- migration runs, so Row-Level Security does not narrow it to one Tenant.
DELETE FROM email_templates WHERE slug IN ('welcome', 'referral_credited');--> statement-breakpoint
DELETE FROM email_switches WHERE slug IN ('welcome', 'referral_credited');
