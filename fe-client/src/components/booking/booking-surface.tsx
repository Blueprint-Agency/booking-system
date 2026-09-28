import { cn } from "@/lib/utils";
import { PAGE_FILL } from "@/components/ui/styles";

const widthMap = {
  md: "max-w-3xl",
  lg: "max-w-5xl",
};

/**
 * The frame of a browse page — Schedule, Workshops, Packages, Merch. The same
 * gutter and width as the account area, and no card around the page: the
 * content is cards already.
 */
export function BookingSurface({
  children,
  className,
  // One width for every browse page, so the title doesn't jump sideways as
  // the member moves between tabs.
  maxWidth = "lg",
  fill = false,
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: keyof typeof widthMap;
  /** Take the page's full height, so a `SurfaceCentre` can centre in it. */
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        // No entry animation of its own: the route template brings every page in.
        "mx-auto w-full px-4 md:px-8 py-5 md:py-10",
        widthMap[maxWidth],
        fill && cn("flex flex-col", PAGE_FILL),
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The one panel a page is while it has nothing else to show — a members-only
 * notice, a not-found — centred in what is left under the page header. Goes
 * inside a `<BookingSurface fill>`.
 */
export function SurfaceCentre({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col justify-center">{children}</div>;
}
