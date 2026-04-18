import { cn } from "@/lib/utils";

type BookingSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  padding?: "tight" | "default" | "loose";
  maxWidth?: "md" | "lg" | "xl" | "full";
};

const paddingMap = {
  tight: "p-6 md:p-8",
  default: "p-8 md:p-12",
  loose: "p-10 md:p-16",
};

const widthMap = {
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "max-w-none",
};

export function BookingSurface({
  children,
  className,
  padding = "default",
  maxWidth = "xl",
}: BookingSurfaceProps) {
  return (
    <section className="bg-warm py-16 md:py-24">
      <div
        className={cn(
          "mx-auto w-full rounded-3xl bg-card shadow-soft border border-ink/5",
          widthMap[maxWidth],
          paddingMap[padding],
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}
