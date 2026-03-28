import Link from "next/link";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon?: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="text-4xl mb-4">{icon}</div>}
      <h3 className="font-serif text-xl text-ink mb-2">{title}</h3>
      <p className="text-muted text-sm max-w-sm mb-6">{description}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-deep transition-colors duration-200"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
