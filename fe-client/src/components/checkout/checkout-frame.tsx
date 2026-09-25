import { cn } from "@/lib/utils";

/**
 * The page around a review-and-pay step: one narrow column straight on the
 * page, with the summary as the only card in it. The browse pages' surface
 * nests a card inside a padded card, and on a 320px phone that nesting left
 * the order summary under 200px wide.
 */
export function CheckoutFrame({
  title,
  description,
  width = "narrow",
  children,
}: {
  title?: string;
  description?: string;
  width?: "narrow" | "wide";
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 sm:px-6 py-6 sm:py-10">
      <div className={cn("mx-auto w-full", width === "narrow" ? "max-w-lg" : "max-w-2xl")}>
        {title && (
          <header className="mb-5 sm:mb-6">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

/** The white summary card a checkout step is built around. */
export const checkoutCardClass =
  "rounded-2xl border border-ink/5 bg-card shadow-soft p-4 sm:p-6";
