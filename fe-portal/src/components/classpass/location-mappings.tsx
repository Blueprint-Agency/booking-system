"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, Select } from "@/components/ui";
import { ApiError, type Api } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import {
  addClassPassLocationMapping,
  changeClassPassLocationMapping,
  listClassPassLocationMappings,
  mappableLocations,
  removeClassPassLocationMapping,
  type ClassPassLocationMapping,
} from "@/lib/classpass";

function refusal(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  switch (code) {
    case ERROR_CODES.classpass_mapping_exists:
      return "That ClassPass name is already mapped. Change its Location instead.";
    case ERROR_CODES.location_archived:
      return "That Location is archived. Choose a live one.";
    case ERROR_CODES.location_not_found:
      return "That Location no longer exists.";
    case ERROR_CODES.classpass_mapping_not_found:
      return "That mapping was already removed.";
    default:
      return err instanceof ApiError ? `That didn’t work (HTTP ${err.status}).` : "That didn’t work.";
  }
}

/**
 * ClassPass location mappings (#410): which of the studio's Locations each
 * name ClassPass writes in its emails means. ClassPass spells a name in more
 * than one way, so the backend stores it normalised (lower case, single
 * spaces, every dash the same), and two spellings are one mapping.
 */
export function ClassPassLocationMappings({
  api,
  locations,
}: {
  api: Api;
  locations: { id: string; name: string; archivedAt: string | null }[];
}) {
  const [mappings, setMappings] = useState<ClassPassLocationMapping[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const options = useMemo(() => mappableLocations(locations), [locations]);

  // Bumped to read the list again (after a write, or by Retry).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    listClassPassLocationMappings(api).then(
      (rows) => {
        if (cancelled) return;
        setMappings(rows);
        setLoadError(null);
      },
      (err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, version]);

  async function run(work: () => Promise<unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await work();
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(refusal(err));
      return false;
    } finally {
      load();
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !locationId) return;
    const ok = await run(
      () => addClassPassLocationMapping(api, { location_name: name, location_id: locationId }),
      "Mapping added.",
    );
    if (ok) {
      setName("");
      setLocationId("");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-ink">Locations</h2>
        <p className="mt-0.5 text-xs text-muted">
          Enter each location name as ClassPass writes it in its emails, and choose the Location it means. Case, spaces
          and dashes don’t matter, and a name ClassPass cuts short can be mapped too.
        </p>
      </header>

      {loadError ? (
        <div className="text-sm text-error">
          Failed to load mappings: {loadError}{" "}
          <button type="button" className="underline" onClick={load}>
            Retry
          </button>
        </div>
      ) : mappings === null ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading mappings…
        </div>
      ) : mappings.length === 0 ? (
        <p className="text-sm text-muted">No locations mapped yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {mappings.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <code className="break-all text-sm text-ink">{m.location_name}</code>
                {m.location.archived_at && (
                  <p className="mt-0.5 text-xs text-warning">{m.location.name} is archived. Choose a live Location.</p>
                )}
              </div>
              <div className="flex items-center gap-2 sm:w-72">
                <Select
                  aria-label={`Location for ${m.location_name}`}
                  value={m.location_id}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () => changeClassPassLocationMapping(api, m.id, { location_id: e.target.value }),
                      "Mapping changed.",
                    )
                  }
                >
                  {!options.some((o) => o.id === m.location_id) && (
                    <option value={m.location_id} disabled>
                      {m.location.name} (archived)
                    </option>
                  )}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${m.location_name}`}
                  onClick={() => void run(() => removeClassPassLocationMapping(api, m.id), "Mapping removed.")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
        <div>
          <Label htmlFor="classpass-location-name">ClassPass name</Label>
          <Input
            id="classpass-location-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder="As written in ClassPass’s emails"
          />
        </div>
        <div>
          <Label htmlFor="classpass-location-id">Location</Label>
          <Select id="classpass-location-id" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choose a Location</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !locationId}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
    </section>
  );
}
