/**
 * The title of an account section. Sized for a dashboard rather than a
 * marketing page. The way between sections is the shell's (sidebar, or tabs
 * below `lg`), so the header carries none of its own.
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
