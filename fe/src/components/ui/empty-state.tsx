import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  cta?: { href: string; label: string };
};

export function EmptyState({ icon: Icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      {Icon ? (
        <div className="mx-auto h-12 w-12 rounded-full bg-warm flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-muted" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="text-sm text-muted mt-1 max-w-sm mx-auto">{description}</p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="inline-flex items-center justify-center mt-6 min-h-[44px] rounded-full bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:bg-ink/90"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
