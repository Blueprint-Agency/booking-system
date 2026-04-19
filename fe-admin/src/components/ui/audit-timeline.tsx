import { formatDateTime } from "@/lib/utils";

export type AuditEntry = {
  id: string;
  label: string;
  detail: string;
  at: string;
  by?: string;
};

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted italic">No activity yet.</p>;
  }
  return (
    <ol className="space-y-4">
      {entries.map((e) => (
        <li key={e.id} className="relative pl-6">
          <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-accent" />
          <p className="text-sm font-medium text-ink">{e.label}</p>
          <p className="text-sm text-muted">{e.detail}</p>
          <p className="text-xs text-muted mt-1 font-mono">
            {formatDateTime(e.at)}
            {e.by ? ` · ${e.by}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
