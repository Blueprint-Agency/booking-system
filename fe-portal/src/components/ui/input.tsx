import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { blurNumberOnWheel } from "@/lib/number-input";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onWheel, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // 16px on a phone: iOS Safari zooms the page into any field set smaller.
        "flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm max-sm:text-base placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
        className
      )}
      // Scrolling the page over a focused number field must not change it.
      onWheel={(e) => {
        blurNumberOnWheel(e.currentTarget);
        onWheel?.(e);
      }}
      {...props}
    />
  )
);
Input.displayName = "Input";
