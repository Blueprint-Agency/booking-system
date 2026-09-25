import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The title of a browse page, sized like an account section's
 * (`AccountPageHeader`) so moving between them doesn't change scale.
 */
export function PageHeader({
  title,
  description,
  back,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  /** A way up to the list this page came from, e.g. all workshops. */
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 md:mb-6">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 mb-2 inline-flex min-h-[36px] items-center gap-0.5 rounded-full pr-2 text-sm font-semibold text-accent-deep hover:text-accent"
        >
          <ChevronLeft className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink break-words">
            {title}
          </h1>
          {description && <p className="mt-1.5 text-sm text-muted max-w-xl">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
