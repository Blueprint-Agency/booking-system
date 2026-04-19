import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  cta?: { href: string; label: string } | ReactNode;
}

export function EmptyState({ icon: Icon, title, description, cta }: EmptyStateProps) {
  const isLinkCta = cta && typeof cta === "object" && "href" in (cta as object);
  const ctaNode = isLinkCta ? (
    <Link
      href={(cta as { href: string }).href}
      className="mt-6 inline-flex min-h-[40px] items-center justify-center rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-deep"
    >
      {(cta as { label: string }).label}
    </Link>
  ) : (
    (cta as ReactNode)
  );
  return (
    <div className="px-6 py-12 text-center">
      {Icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warm">
          <Icon className="h-6 w-6 text-muted" />
        </div>
      )}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {ctaNode}
    </div>
  );
}
