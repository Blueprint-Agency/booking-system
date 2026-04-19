import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "sage" | "warning" | "error" | "cyan";

const TONE: Record<Tone, string> = {
  neutral: "bg-warm text-ink",
  accent: "bg-accent/10 text-accent-deep",
  sage: "bg-sage/15 text-sage",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  cyan: "bg-cyan/15 text-cyan-deep",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
