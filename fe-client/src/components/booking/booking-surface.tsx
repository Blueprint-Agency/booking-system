import { cn } from "@/lib/utils";

type BookingSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  padding?: "tight" | "default" | "loose";
  maxWidth?: "md" | "lg" | "xl" | "full";
  /**
   * No card chrome below `md`: the content sits straight on the page with a
   * 16px gutter. A browse page is a list of cards already, and a card around
   * them on a phone costs ~48px of width and draws a box inside a box. From
   * `md` up it is the same card as every other surface.
   */
  flush?: boolean;
};

const paddingMap = {
  tight: "p-5 md:p-6",
  // `p-6` at the base is load-bearing: full-bleed strips inside the surface
  // cancel it with `-mx-6`.
  default: "p-6 md:p-8",
  loose: "p-6 sm:p-8 md:p-12",
};

const widthMap = {
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "max-w-none",
};

/**
 * Full-bleed on a `flush` surface: cancels the page gutter below `md` so a
 * sideways-scrolling strip runs edge to edge, and keeps its first item on the
 * gutter line.
 */
export const FLUSH_BLEED = "-mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0";

export function BookingSurface({
  children,
  className,
  padding = "default",
  maxWidth = "xl",
  flush = false,
}: BookingSurfaceProps) {
  if (flush) {
    return (
      <section className="px-4 py-5 sm:px-6 sm:py-8 md:bg-warm md:px-8 md:py-12">
        <div
          className={cn(
            "mx-auto w-full md:rounded-3xl md:bg-card md:shadow-soft md:border md:border-ink/5 md:p-8",
            widthMap[maxWidth],
            className,
          )}
        >
          {children}
        </div>
      </section>
    );
  }
  return (
    <section className="bg-warm py-8 md:py-12 px-4 sm:px-6 md:px-8">
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
