"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { img } from "@/data/images";
import { cn } from "@/lib/utils";

export type HeroProps = {
  imageKey: string;
  eyebrow?: string;
  headline: string;
  rotatingWords?: string[];
  subheadline: string;
  primaryCta: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
  variant?: "compact" | "full";
};

const easeOut = [0.22, 1, 0.36, 1] as const;

export function Hero({
  imageKey,
  eyebrow,
  headline,
  rotatingWords,
  subheadline,
  primaryCta,
  secondaryCta,
  variant = "full",
}: HeroProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!rotatingWords || rotatingWords.length < 2) return;
    const id = setInterval(
      () => setCurrentIndex((i) => (i + 1) % rotatingWords.length),
      3000
    );
    return () => clearInterval(id);
  }, [rotatingWords]);

  const image = img(imageKey);
  const hasRotating =
    headline.includes("{rotating}") && rotatingWords && rotatingWords.length >= 2;
  const [before, after] = hasRotating ? headline.split("{rotating}") : [headline, ""];

  return (
    <section
      className={cn(
        "relative w-full",
        variant === "compact"
          ? "h-[50vh] min-h-[420px]"
          : "h-[70vh] min-h-[560px]"
      )}
    >
      {/* Background image */}
      <Image
        src={image.unsplash}
        alt={image.alt}
        fill
        priority
        className="object-cover photo-warm"
        sizes="100vw"
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-[var(--color-overlay)]" aria-hidden />

      {/* Content */}
      <div className="relative z-10 max-w-[1280px] mx-auto px-6 sm:px-8 h-full flex flex-col justify-center">
        {/* Eyebrow */}
        {eyebrow && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0, ease: easeOut }}
          >
            <p className="text-[12px] font-bold uppercase tracking-wider text-paper/80 mb-4">
              {eyebrow}
            </p>
          </motion.div>
        )}

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08, ease: easeOut }}
        >
          <h1 className="text-[48px] sm:text-[64px] lg:text-[80px] font-extrabold leading-[1.05] tracking-tight text-paper mb-4">
            {hasRotating ? (
              <>
                <span className="block">{before.trimEnd()}</span>
                <span className="block overflow-hidden text-cyan pb-[0.18em] -mb-[0.18em]">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={rotatingWords![currentIndex]}
                      initial={{ y: 24, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -24, opacity: 0 }}
                      transition={{ duration: 0.4, ease: easeOut }}
                      className="inline-block"
                    >
                      {rotatingWords![currentIndex]}
                    </motion.span>
                  </AnimatePresence>
                  {after}
                </span>
              </>
            ) : (
              headline.replace("{rotating}", "")
            )}
          </h1>
        </motion.div>

        {/* Subheadline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: easeOut }}
        >
          <p className="text-[18px] sm:text-[20px] leading-relaxed text-paper/85 max-w-[60ch] mb-8">
            {subheadline}
          </p>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.24, ease: easeOut }}
        >
          <div className="flex flex-col sm:flex-row gap-3">
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
        </motion.div>
      </div>
    </section>
  );
}
