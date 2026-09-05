"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import {
  SLUG_REASONS,
  checkSlug,
  createTenant,
  suggestSlug,
  type SlugVerdict,
} from "@/lib/platform";

/**
 * Onboarding a studio, as one form.
 *
 * The slug is the load-bearing field: it becomes two hostnames the moment the
 * studio exists, and it can never be changed without breaking every link the
 * studio has handed out. So it is checked while the operator types — reserved,
 * malformed and taken slugs all become a message under the field rather than a
 * failed submit — and the check is the backend's, not a second copy of the
 * rules living here.
 *
 * Everything else a studio needs (locations, class types, staff) is set up by
 * its own admin, who is invited by this form and takes it from there — unless
 * the studio is being created to receive an archive, which brings all of that
 * with it. That is why the first admin is optional: `importTenant` refuses a
 * studio that already holds `staff_users` rows, so a studio about to be
 * imported into must be created with none.
 */
export interface CreateTenantDialogProps {
  api: Api;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

/** The platform's home zone. Every job a studio runs fires in its own zone, so a
 *  studio elsewhere must have this changed at creation, not afterwards. */
const DEFAULT_TIMEZONE = "Asia/Singapore";

export function CreateTenantDialog({ api, open, onOpenChange, onCreated }: CreateTenantDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /** True once the operator edits the slug themselves — after that the name
   *  stops overwriting it, or their edit would vanish on the next keystroke. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [verdict, setVerdict] = useState<SlugVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    // Reset on close, so a cancelled create does not leave half a studio in the
    // form for the next one.
    setName("");
    setSlug("");
    setSlugTouched(false);
    setTimezone(DEFAULT_TIMEZONE);
    setAdminEmail("");
    setAdminName("");
    setVerdict(null);
  }, [open]);

  // Debounced availability check. The dependency is the slug alone, so typing in
  // any other field does not re-ask.
  useEffect(() => {
    if (!open || !slug) {
      setVerdict(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const result = await checkSlug(api, slug);
        if (!cancelled) setVerdict(result);
      } catch {
        // A failed check must not block the form — the create itself is the
        // authority and refuses the same slugs for the same reasons.
        if (!cancelled) setVerdict(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [api, open, slug]);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(suggestSlug(value));
  }

  const slugProblem = verdict && !verdict.available ? verdict.reason : undefined;
  // The first admin is not required. A studio created to receive an archive
  // must be left with no staff rows at all — the archive brings its own, and
  // the import refuses to merge into rows that are already there.
  const canSubmit = !submitting && name.trim() && slug && verdict?.available === true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const created = await createTenant(api, {
        slug,
        name: name.trim(),
        timezone,
        ...(adminEmail.trim() ? { admin_email: adminEmail.trim() } : {}),
        ...(adminName.trim() ? { admin_name: adminName.trim() } : {}),
      });
      toast.success(
        created.admin
          ? `${created.tenant.name} is live. ${created.admin.email} has been invited.`
          : `${created.tenant.name} is created and suspended — nobody can sign in yet. Import an archive, or invite its first admin.`,
      );
      onCreated();
    } catch (err) {
      // The backend is atomic: a failure here left no studio behind, in the
      // database or in either Clerk application. Say what went wrong and let
      // them try again.
      const code =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: string }).error
          : undefined;
      toast.error(
        code && SLUG_REASONS[code]
          ? SLUG_REASONS[code]
          : code === "admin_email_invalid"
            ? "That admin email doesn’t look like an address."
            : "Could not create the studio. Nothing was left half-created — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New studio"
      description="Creates the studio and its Clerk organization, and invites a first admin if you name one. Its URLs work immediately."
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-name">Studio name</Label>
          <Input
            id="tenant-name"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Acme Yoga"
            autoFocus
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-slug">Address</Label>
          <Input
            id="tenant-slug"
            value={slug}
            onChange={e => {
              setSlugTouched(true);
              setSlug(e.target.value.trim().toLowerCase());
            }}
            placeholder="acme"
            required
            aria-invalid={Boolean(slugProblem)}
            aria-describedby="tenant-slug-help"
          />
          <p id="tenant-slug-help" className="text-xs text-muted">
            {checking ? (
              "Checking…"
            ) : slugProblem ? (
              <span className="text-error">{SLUG_REASONS[slugProblem] ?? "Not usable."}</span>
            ) : slug && verdict?.available ? (
              // Not spelled out as a full hostname: the root domain differs per
              // environment, and the created studio's real URLs come back on the
              // response rather than being guessed here.
              <span className="text-sage">“{slug}” is free.</span>
            ) : (
              "Becomes the studio’s two hostnames. It cannot be changed later."
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-timezone">Time zone</Label>
          <Input
            id="tenant-timezone"
            value={timezone}
            onChange={e => setTimezone(e.target.value.trim())}
            placeholder={DEFAULT_TIMEZONE}
            required
          />
          <p className="text-xs text-muted">
            IANA zone. Every scheduled job for this studio fires in it.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-admin-email">First admin’s email (optional)</Label>
          <Input
            id="tenant-admin-email"
            type="email"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            placeholder="owner@acmeyoga.com"
          />
          <p className="text-xs text-muted">
            They are invited to the studio’s portal and set everything else up from there. Leave it
            blank if you are about to import an archive — that brings the studio’s own staff, and
            the import needs an empty studio. A studio with nobody in it is created suspended, and
            opens when it has its first admin.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-admin-name">First admin’s name (optional)</Label>
          <Input
            id="tenant-admin-name"
            value={adminName}
            onChange={e => setAdminName(e.target.value)}
            placeholder="Jane Tan"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create studio
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
