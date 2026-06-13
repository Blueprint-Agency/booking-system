import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl mb-6", align === "center" && "text-center mx-auto")}>
      {eyebrow ? (
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-accent-deep mb-2">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-ink leading-[1.1]">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-base sm:text-lg text-muted leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
