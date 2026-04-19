import type { LucideIcon } from "lucide-react";
import { Card } from "./card";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
          <p className="text-2xl font-extrabold text-ink mt-1 font-mono">{value}</p>
          {hint ? <p className="text-xs text-muted mt-1">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="h-9 w-9 rounded-full bg-accent/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-accent-deep" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
