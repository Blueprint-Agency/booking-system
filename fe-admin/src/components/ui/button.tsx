import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  secondary: "bg-card text-ink border border-border hover:bg-warm",
  ghost: "bg-transparent text-ink hover:bg-warm",
  danger: "bg-error text-paper hover:bg-error/90",
};

const SIZE: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5 min-h-[32px]",
  md: "text-sm px-4 py-2 min-h-[40px]",
  lg: "text-sm px-5 py-2.5 min-h-[44px]",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
