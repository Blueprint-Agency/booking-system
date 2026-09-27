"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Button, Dialog, DialogFooter, Input, Label } from "@/components/ui";
import type { PlatformTenant } from "@/lib/platform";

/**
 * Replace a studio's data with an archive's (#339).
 *
 * Everything the studio holds is deleted and the file's rows written in its
 * place — so, like deleting a studio, it asks for the studio's address typed
 * out, and the backend checks the same thing again. What it keeps is said
 * before it is asked: its people's sign-ins, its branding and settings, its
 * payment account and its status.
 *
 * The dialog only gathers the file and the confirmation. The upload itself is
 * the page's, so it shows in the studio's row with the same progress panel as a
 * restore, and carries on after this closes.
 */
export interface ReplaceTenantDialogProps {
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (tenant: PlatformTenant, file: File, confirmSlug: string) => void;
}

export function ReplaceTenantDialog({ tenant, onOpenChange, onConfirm }: ReplaceTenantDialogProps) {
  // Keyed on the studio by the parent, so each opening starts empty.
  const [typed, setTyped] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const matches = Boolean(tenant && typed.trim().toLowerCase() === tenant.slug);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant || !file || !matches) return;
    onConfirm(tenant, file, typed.trim().toLowerCase());
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Replace from archive"
      description={tenant ? `Replace everything ${tenant.name} holds with an archive’s contents.` : ""}
    >
      {tenant && (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-ink">
            <p>
              Every member, booking, class, package, payment record and staff record in{" "}
              <span className="font-medium">{tenant.name}</span> is deleted, and the archive’s are
              written in their place. Anything made since the archive was built is lost.
            </p>
            <p className="mt-2">
              Kept as they are: everyone’s sign-in — members and staff who already sign in here
              keep their email, password and second factor — and the studio’s address, name,
              branding, settings, payment account, term and status.
            </p>
            <p className="mt-2 text-muted">
              Export the studio first if there is any chance you will want its current data back.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replace-file">Archive</Label>
            <label
              htmlFor="replace-file"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm text-ink hover:bg-paper focus-within:ring-2 focus-within:ring-accent"
            >
              <Upload className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 wrap-anywhere">{file ? file.name : "Choose a .zip file"}</span>
              <input
                id="replace-file"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                onChange={event => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replace-confirm">
              Type <span className="font-mono">{tenant.slug}</span> to confirm
            </Label>
            <Input
              id="replace-confirm"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!file || !matches}>
              Replace data
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
