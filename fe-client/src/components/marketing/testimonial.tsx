import Image from "next/image";
import { img } from "@/data/images";

export type TestimonialProps = {
  quote: string;
  attribution: { name: string; role?: string };
  avatarImageKey?: string;
};

export function Testimonial({ quote, attribution, avatarImageKey }: TestimonialProps) {
  const avatar = avatarImageKey ? img(avatarImageKey) : null;
  return (
    <section className="py-20 sm:py-28 bg-warm">
      <div className="max-w-[960px] mx-auto px-6 sm:px-8 text-center">
        <div className="text-[80px] leading-[0.5] text-accent/30 font-extrabold mb-2 select-none" aria-hidden>
          &ldquo;
        </div>
        <blockquote className="text-[24px] sm:text-[32px] leading-snug font-medium text-ink tracking-tight max-w-[44ch] mx-auto mb-8">
          {quote}
        </blockquote>
        <div className="flex items-center justify-center gap-3">
          {avatar && (
            <div className="relative w-10 h-10 rounded-full overflow-hidden">
              <Image
                src={avatar.unsplash}
                alt={avatar.alt}
                fill
                className="object-cover"
                sizes="40px"
              />
            </div>
          )}
          <div className="text-left">
            <p className="text-[14px] font-bold text-ink">{attribution.name}</p>
            {attribution.role && (
              <p className="text-[12px] text-muted">{attribution.role}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
