import { cn } from "@/lib/utils";

export function Table({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={cn("w-full text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-warm text-left text-xs uppercase tracking-wider text-muted">
      {children}
    </thead>
  );
}

export function TR({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-t border-border hover:bg-warm/40 transition-colors",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 text-ink", className)}>{children}</td>;
}
