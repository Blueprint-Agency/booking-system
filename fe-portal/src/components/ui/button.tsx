import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonStyles = cva(
  // shrink-0 + whitespace-nowrap: in a narrow row a button must keep its own
  // width and push the row to wrap, never let its label collapse to one word
  // per line while the text beside it gets crushed to nothing.
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-deep",
        secondary: "bg-card text-ink border border-border hover:bg-paper",
        ghost: "bg-transparent text-ink hover:bg-paper",
        danger: "bg-error text-white hover:opacity-90",
      },
      size: {
        // A size up on a phone, where these are thumbed rather than clicked.
        sm: "h-9 px-3 text-sm sm:h-8",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
