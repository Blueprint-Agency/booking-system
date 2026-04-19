import Link from "next/link";

export type TrustedByProps = {
  label?: string;
  logos: Array<{ name: string; href?: string }>;
};

export function TrustedBy({ label = "Trusted by", logos }: TrustedByProps) {
  return (
    <section className="py-12 sm:py-16 border-t border-b border-border bg-paper">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        <p className="text-center text-[12px] font-bold uppercase tracking-wider text-muted/70 mb-6">
          {label}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {logos.map((logo) => {
            const className = "text-[18px] font-extrabold tracking-tight text-muted hover:text-ink transition-colors";
            return logo.href ? (
              <Link key={logo.name} href={logo.href} className={className}>
                {logo.name}
              </Link>
            ) : (
              <span key={logo.name} className={className}>
                {logo.name}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
