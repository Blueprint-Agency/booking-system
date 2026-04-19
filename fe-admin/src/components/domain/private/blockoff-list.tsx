"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { Button, Input, Select, EmptyState } from "@/components/ui";
import { addBlockoff, removeBlockoff } from "@/lib/mutations/availability";

export interface BlockoffListProps {
  instructorId?: string;
}

export function BlockoffList({ instructorId }: BlockoffListProps) {
  const instructors = useAdminState((s) => s.instructors);
  const blockoffs = useAdminState((s) => s.availabilityBlockoffs);
  const [iid, setIid] = useState<string>(instructorId ?? instructors[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const rows = useMemo(
    () => blockoffs.filter((b) => b.instructorId === iid).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [blockoffs, iid],
  );

  const add = () => {
    if (!start || !end) {
      toast.error("Pick a date range");
      return;
    }
    addBlockoff({
      instructorId: iid,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      reason,
    });
    toast.success("Block-off added");
    setStart("");
    setEnd("");
    setReason("");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {!instructorId && (
            <Select value={iid} onChange={(e) => setIid(e.target.value)}>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="Start"
          />
          <Input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="End"
          />
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="button" onClick={add}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No block-offs" description="Add date-range overrides on top of the weekly template." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Start</th>
                <th className="px-3 py-2 text-left font-medium">End</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-ink">{new Date(b.startAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink">{new Date(b.endAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted">{b.reason ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        removeBlockoff(b.id);
                        toast.success("Removed");
                      }}
                      className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
                      aria-label="Remove block-off"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
