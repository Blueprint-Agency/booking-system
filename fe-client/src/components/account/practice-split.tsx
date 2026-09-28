"use client";

/**
 * "What you practised" on My activity: the period's sessions as one bar split
 * into parts — the most-attended class types in shades of the studio's accent,
 * the rest of the classes palest, private sessions in the gold a PT booking
 * wears everywhere else and workshops in their green — then a row per part with its count and share. One
 * bar, so the parts read as a whole: three single sessions are thirds, not
 * three full bars. It runs out from the left on load; with reduced motion it
 * is simply there.
 */
import { cn } from "@/lib/utils";
import type { PracticePart } from "@/lib/practice";

/** The class types' shades, most attended darkest. */
const CLASS_SHADES = ["bg-accent", "bg-accent/65", "bg-accent/40"];

function tone(part: PracticePart, i: number): string {
  if (part.kind === "pt") return "bg-gold";
  if (part.kind === "workshop") return "bg-green";
  if (part.kind === "other") return "bg-accent/20";
  return CLASS_SHADES[i] ?? "bg-accent/20";
}

export function PracticeSplit({ parts }: { parts: PracticePart[] }) {
  return (
    <section aria-labelledby="practised-heading" className="mt-6">
      <h2 id="practised-heading" className="mb-3 text-base font-bold text-ink">
        What you practised
      </h2>
      <div aria-hidden className="practice-grow-x flex h-3 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p, i) => (
          <span key={`${p.kind}:${p.name}`} className={cn("block h-full", tone(p, i))} style={{ width: `${p.share * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 divide-y divide-ink/5">
        {parts.map((p, i) => (
          <li key={`${p.kind}:${p.name}`} className="flex items-center gap-2.5 py-2 text-sm">
            <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", tone(p, i))} />
            <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-ink">{p.attended}</span>
              <span className="text-muted"> · {p.percent}%</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
