import { cn } from "@/lib/utils";

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
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: keyof typeof widthMap;
}) {
  return (
    <div
      className={cn(
        // No entry animation of its own: the route template brings every page in.
        "mx-auto w-full px-4 md:px-8 py-5 md:py-10",
        widthMap[maxWidth],
        className,
      )}
    >
      {children}
    </div>
  );
}
