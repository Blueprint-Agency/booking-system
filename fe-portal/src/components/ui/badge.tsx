import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeStyles = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-warm text-ink",
        accent: "bg-accent/10 text-accent",
        sage: "bg-sage/15 text-sage",
        warning: "bg-warning/15 text-warning",
        error: "bg-error/15 text-error",
        cyan: "bg-cyan/15 text-cyan-deep",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}
