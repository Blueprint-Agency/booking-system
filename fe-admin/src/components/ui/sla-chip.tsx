"use client";

import { useEffect, useState } from "react";
import { slaLabel, slaTier, type SlaTier } from "@/lib/sla";
import { cn } from "@/lib/utils";

const TONE: Record<SlaTier, string> = {
  green: "bg-sage/15 text-sage",
  amber: "bg-warning/15 text-warning",
  red: "bg-error/15 text-error",
  overdue: "bg-error text-paper",
};

export function SlaChip({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const tier = slaTier(deadlineAt, now);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tier])}>
      {slaLabel(deadlineAt, now)}
    </span>
  );
}
