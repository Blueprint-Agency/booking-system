import { BookingSurface } from "@/components/booking/booking-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/components/ui/styles";

/**
 * While a page's code or server data is on its way: the page's own frame — a
 * title and a stack of cards — so the real page lands where this one stood.
 * It fades in a beat late, so a quick load shows nothing but the page.
 */
export default function Loading() {
  return (
    <BookingSurface>
      <div
        className="animate-fade-in [animation-delay:150ms]"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-8 w-40 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${CARD} p-4 sm:p-5`}>
              <Skeleton className="h-4 w-1/3 mb-3" />
              <Skeleton className="h-3 w-2/3 mb-2" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </BookingSurface>
  );
}
