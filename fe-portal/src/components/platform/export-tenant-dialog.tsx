"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button, Dialog, DialogFooter } from "@/components/ui";
import type { PlatformTenant } from "@/lib/platform";

/**
 * Export a studio's archive, with or without its people's passwords.
 *
 * Without is the default and the routine backup. With carries each member's
 * and staff member's password hash, so restoring the archive in another
 * environment keeps their sign-ins; it says what that file now is, and the
 * backend records the export in the studio's audit log.
 */
export interface ExportTenantDialogProps {
  tenant: PlatformTenant | null;
  onOpenChange: (open: boolean) => void;
  /** Download the archive; resolves once the file is handed to the browser. */
  onExport: (tenant: PlatformTenant, options: { withPasswords: boolean }) => Promise<void>;
}

export function ExportTenantDialog({ tenant, onOpenChange, onExport }: ExportTenantDialogProps) {
  // The parent keys this component on the studio, so a closed dialog remounts
  // with the box unticked: no state to reset here.
  const [withPasswords, setWithPasswords] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function submit() {
    if (!tenant) return;
    setExporting(true);
    try {
      await onExport(tenant, { withPasswords });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(tenant)}
      onOpenChange={onOpenChange}
      title="Export archive"
      description={tenant ? `Everything ${tenant.name} holds, as a zip.` : ""}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex min-h-9 items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={withPasswords}
            onChange={e => setWithPasswords(e.target.checked)}
          />
          <span>
            Include passwords
            <span className="block text-xs text-muted">
              Members and staff keep their passwords when this archive is restored in another environment.
              Second factors and open sessions are never included: staff set up their authenticator again.
            </span>
          </span>
        </label>

        {withPasswords && (
          <div role="note" className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-ink">
            This file will hold every member&apos;s and staff member&apos;s password hash. Keep it private, delete it
            once it is restored, and do not keep it as a routine backup. The export is recorded in the
            studio&apos;s audit log.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {withPasswords ? "Export with passwords" : "Export"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
