import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The title of an account section. Sized for a dashboard rather than a
 * marketing page, and on phones and tablets it carries the way back to the
 * account menu — there is no sidebar below `lg`.
 */
export function AccountPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  /** A control that sits at the title's right, e.g. "Book a class". */
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 md:mb-6">
      <Link
        href="/account"
        className="lg:hidden -ml-1 mb-2 inline-flex min-h-[36px] items-center gap-0.5 rounded-full pr-2 text-sm font-semibold text-accent-deep hover:text-accent"
      >
        <ChevronLeft className="h-4 w-4" />
        Account
      </Link>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted max-w-xl">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
