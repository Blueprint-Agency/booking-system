import Link from "next/link";
import Image from "next/image";
import { img } from "@/data/images";

export type CtaBannerProps = {
  imageKey: string;
  eyebrow?: string;
  headline: string;
  subheadline?: string;
  primaryCta: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
};

export function CtaBanner({
  imageKey,
  eyebrow,
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
}: CtaBannerProps) {
  const image = img(imageKey);
  return (
    <section className="relative w-full h-[60vh] min-h-[480px] overflow-hidden">
      <Image
        src={image.unsplash}
        alt={image.alt}
        fill
        className="object-cover photo-warm"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-[rgba(13,26,62,0.6)]" aria-hidden />
      <div className="relative z-10 max-w-[800px] mx-auto px-6 sm:px-8 h-full flex flex-col items-center justify-center text-center text-paper">
        {eyebrow && (
          <p className="text-[12px] font-bold uppercase tracking-wider text-paper/80 mb-4">
            {eyebrow}
          </p>
        )}
        <h2 className="text-[40px] sm:text-[56px] font-extrabold leading-[1.1] tracking-tight mb-5">
          {headline}
        </h2>
        {subheadline && (
          <p className="text-[17px] sm:text-[20px] leading-relaxed text-paper/85 mb-8 max-w-[40ch] mx-auto">
            {subheadline}
          </p>
        )}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link
            href={primaryCta.href}
            className="inline-flex items-center gap-2 px-6 py-3 text-[14px] font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors duration-200"
          >
            {primaryCta.label}
          </Link>
          {secondaryCta && (
            <Link
              href={secondaryCta.href}
              className="inline-flex items-center gap-2 px-6 py-3 text-[14px] font-bold text-paper border border-paper/30 rounded-md hover:bg-paper/10 transition-colors duration-200"
            >
              {secondaryCta.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
