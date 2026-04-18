"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { img } from "@/data/images";

export type ShowcaseItem = {
  imageKey?: string;
  imageSrc?: string;
  imageAlt: string;
  label: string;
  description?: string;
  href?: string;
};

export type ShowcaseGridProps = {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  items: ShowcaseItem[];
  columns?: 2 | 3 | 4; // default 3
};

function resolveItemSrc(item: ShowcaseItem): string {
  if (!item.imageKey === !item.imageSrc) {
    throw new Error(
      `ShowcaseGrid item "${item.label}": provide exactly one of imageKey or imageSrc`
    );
  }
  return item.imageKey ? img(item.imageKey).unsplash : item.imageSrc!;
}

const easeOut = [0.22, 1, 0.36, 1] as const;

export function ShowcaseGrid({
  eyebrow,
  headline,
  subheadline,
  items,
  columns = 3,
}: ShowcaseGridProps) {
  const hasHeader = eyebrow || headline || subheadline;

  const colClass =
    columns === 2
      ? "lg:grid-cols-2"
      : columns === 4
        ? "lg:grid-cols-4"
        : "lg:grid-cols-3";

  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        {hasHeader && (
          <div className="text-center mb-12">
            {eyebrow && (
              <p className="text-[12px] font-bold uppercase tracking-wider text-accent-deep mb-4">
                {eyebrow}
              </p>
            )}
            {headline && (
              <h2 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-ink mb-4">
                {headline}
              </h2>
            )}
            {subheadline && (
              <p className="text-[17px] leading-relaxed text-muted max-w-[60ch] mx-auto">
                {subheadline}
              </p>
            )}
          </div>
        )}

        <div className={`grid grid-cols-1 md:grid-cols-2 ${colClass} gap-6 lg:gap-8`}>
          {items.map((item, i) => {
            const src = resolveItemSrc(item);
            const cardClass =
              "group block relative overflow-hidden rounded-lg shadow-soft hover:shadow-hover transition-shadow";

            const cardInner = (
              <>
                {/* Image wrapper */}
                <div className="relative aspect-[4/5] overflow-hidden">
                  <Image
                    src={src}
                    alt={item.imageAlt}
                    fill
                    className="object-cover photo-warm transition-transform duration-700 group-hover:scale-105"
                    sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  />
                </div>

                {/* Bottom gradient overlay */}
                <div
                  className="absolute bottom-0 inset-x-0 h-2/5 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent pointer-events-none"
                  aria-hidden
                />

                {/* Caption */}
                <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6 text-paper">
                  <p className="text-[20px] font-extrabold tracking-tight">
                    {item.label}
                  </p>
                  {item.description && (
                    <p className="text-[13px] text-paper/80 mt-1 leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>
              </>
            );

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: easeOut }}
              >
                {item.href ? (
                  <Link href={item.href} className={cardClass}>
                    {cardInner}
                  </Link>
                ) : (
                  <div className={cardClass}>{cardInner}</div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
