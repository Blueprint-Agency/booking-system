"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ClientFilterState = {
  q: string;
  waiver: "all" | "signed" | "unsigned";
  activity: "all" | "active" | "inactive";
};

export function ClientFilters({
  value,
  onChange,
}: {
  value: ClientFilterState;
  onChange: (v: ClientFilterState) => void;
}) {
  const setQ = (q: string) => onChange({ ...value, q });
  const setWaiver = (waiver: ClientFilterState["waiver"]) => onChange({ ...value, waiver });
  const setActivity = (activity: ClientFilterState["activity"]) => onChange({ ...value, activity });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Search name, email, phone"
        value={value.q}
        onChange={(e) => setQ(e.target.value)}
        className="min-w-[240px] flex-1"
      />
      <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
        {(["all", "active", "inactive"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setActivity(a)}
            className={
              "rounded-md px-3 py-1 capitalize " +
              (value.activity === a ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
            }
          >
            {a}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
        {(["all", "signed", "unsigned"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWaiver(w)}
            className={
              "rounded-md px-3 py-1 capitalize " +
              (value.waiver === w ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
            }
          >
            Waiver: {w}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ q: "", waiver: "all", activity: "all" })}
      >
        Reset
      </Button>
    </div>
  );
}
