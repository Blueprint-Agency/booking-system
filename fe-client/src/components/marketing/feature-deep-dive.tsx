"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { img } from "@/data/images";

export type FeatureDeepDiveProps = {
  eyebrow?: string;
  headline: string;
  body: string;
  bullets: string[];
  /** Image side at lg+ breakpoint. Default "right". */
  direction?: "left" | "right";
  /** EXACTLY ONE of imageKey or imageSrc must be provided — throws if both/neither. */
  imageKey?: string;
  imageSrc?: string;
  imageAlt: string;
  cta?: { href: string; label: string };
};

const easeOut = [0.22, 1, 0.36, 1] as const;

export function FeatureDeepDive({
  eyebrow,
  headline,
  body,
  bullets,
  direction = "right",
  imageKey,
  imageSrc,
  imageAlt,
  cta,
}: FeatureDeepDiveProps) {
  // Validate exactly one of imageKey or imageSrc is provided
  if (!imageKey === !imageSrc) {
    throw new Error(
      "FeatureDeepDive: provide exactly one of imageKey or imageSrc"
    );
  }

  const src = imageKey ? img(imageKey).unsplash : imageSrc!;
  const isLeft = direction === "left";

  return (
    <section className="py-20 sm:py-28 bg-card">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Image column — DOM-first so mobile shows image-then-text */}
          <motion.div
            className={isLeft ? "lg:order-1" : "lg:order-2"}
            initial={{ opacity: 0, x: isLeft ? -24 : 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: easeOut }}
          >
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden shadow-soft">
              <Image
                src={src}
                alt={imageAlt}
                fill
                className="object-cover photo-warm"
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            </div>
          </motion.div>

          {/* Text column */}
          <motion.div
            className={isLeft ? "lg:order-2" : "lg:order-1"}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
          >
            {eyebrow && (
              <p className="text-[12px] font-bold uppercase tracking-wider text-accent-deep mb-4">
                {eyebrow}
              </p>
            )}

            <h2 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-ink">
              {headline}
            </h2>

            <p className="text-[17px] leading-relaxed text-muted mt-4 mb-6">
              {body}
            </p>

            <ul className="space-y-3">
              {bullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex gap-3 items-start text-[15px] leading-relaxed text-ink"
                >
                  <Check
                    className="w-5 h-5 text-sage shrink-0 mt-0.5"
                    strokeWidth={2}
                  />
                  {bullet}
                </li>
              ))}
            </ul>

            {cta && (
              <div className="mt-8">
                <Link
                  href={cta.href}
                  className="inline-flex items-center gap-1.5 text-accent-deep font-bold hover:text-accent transition-colors text-[15px]"
                >
                  {cta.label}
                  <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
