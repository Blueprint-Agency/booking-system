"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Label, LoadFailure, StatusBadge, Textarea } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { answeredElsewhere } from "@/lib/failed-read";
import { getMaintenance, setMaintenance, type PlatformMaintenance } from "@/lib/platform";

/**
 * Maintenance mode's switch (be/CONTEXT.md § Maintenance mode). On, every
 * studio's member app and portal show the message and nothing else, within a
 * few seconds; this page keeps working, so it is switched off from here too.
 * Used around a deploy: on before merging, off once the backend has deployed.
 */
export function MaintenanceCard({ api }: { api: Api }) {
  const [state, setState] = useState<PlatformMaintenance | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);
  // The switch could not be read: said, with Try again, never a spinner that never ends.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setFailed(false);
    getMaintenance(api).then(
      m => {
        setState(m);
        setMessage(m.message);
      },
      err => {
        // A 404 is the backend refusing this account the super portal, which
        // it does not confirm exists: say so as /platform does, not as a fault.
        if (err instanceof ApiError && err.status === 404) setRefused(true);
        else if (!answeredElsewhere(err)) {
          setFailed(true);
          toast.error("Could not read maintenance mode.");
        }
      },
    );
  }, [api, attempt]);

  async function save(enabled: boolean) {
    if (enabled && !state?.enabled && !window.confirm("Turn maintenance on? Every studio's member app and portal close until it is turned off.")) {
      return;
    }
    setSaving(true);
    try {
      const m = await setMaintenance(api, { enabled, message: message.trim() });
      setState(m);
      setMessage(m.message);
      toast.success(m.enabled ? "Maintenance is on." : "Maintenance is off.");
    } catch {
      toast.error("Could not change maintenance mode.");
    } finally {
      setSaving(false);
    }
  }

  if (refused) {
    return <EmptyState title="Not available" description="This address isn’t available for your account." />;
  }
  if (!state && failed) {
    return <LoadFailure what="the maintenance switch" onRetry={() => setAttempt(n => n + 1)} />;
  }
  if (!state) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  const blank = message.trim() === "";

  return (
    <section className="mb-6 rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium text-ink">Maintenance mode</h2>
        <StatusBadge status={state.enabled ? "suspended" : "active"} label={state.enabled ? "On" : "Off"} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {state.enabled
          ? "Every studio is closed and shows the message below. This page stays open."
          : "Closes every studio's member app and portal, showing the message below. This page stays open."}
        {state.updated_by && state.updated_at
          ? ` Last changed by ${state.updated_by}, ${new Date(state.updated_at).toLocaleString()}.`
          : ""}
      </p>
      <Label htmlFor="maintenance-message" className="mt-3 block">
        Message
      </Label>
      <Textarea
        id="maintenance-message"
        className="mt-1"
        maxLength={500}
        value={message}
        onChange={e => setMessage(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {state.enabled ? (
          <>
            <Button variant="primary" disabled={saving} onClick={() => void save(false)}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Turn off
            </Button>
            <Button
              variant="secondary"
              disabled={saving || blank || message.trim() === state.message}
              onClick={() => void save(true)}
            >
              Save message
            </Button>
          </>
        ) : (
          <Button variant="danger" disabled={saving || blank} onClick={() => void save(true)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Turn on
          </Button>
        )}
      </div>
    </section>
  );
}
