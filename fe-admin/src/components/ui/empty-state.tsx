import type { LucideIcon } from "lucide-react";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
};

export function EmptyState({ icon: Icon, title, description }: Props) {
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
    </div>
  );
}
