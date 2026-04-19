import { type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs uppercase tracking-wider text-muted mb-1.5 block", className)}
      {...rest}
    >
      {children}
    </label>
  );
}
