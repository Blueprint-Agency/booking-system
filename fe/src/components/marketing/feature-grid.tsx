"use client";

import * as LucideIcons from "lucide-react";
import { motion } from "framer-motion";
import type { ComponentType, SVGProps } from "react";

type LucideIconType = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>;

function resolveIcon(name: string): LucideIconType {
  const Icon = (LucideIcons as unknown as Record<string, LucideIconType>)[name];
  if (!Icon) {
    throw new Error(
      `FeatureGrid: lucide-react icon "${name}" not found. Check exports in lucide-react v1.8.0.`
    );
  }
  return Icon;
}

function getGridCols(count: number): string {
  if (count === 4) return "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4";
  if (count === 6) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
  if (count === 8) return "grid-cols-2 sm:grid-cols-4 lg:grid-cols-4";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3";
}

export type FeatureGridItem = {
  icon: string;
  label: string;
  description?: string;
};

export type FeatureGridProps = {
  eyebrow?: string;
  headline?: string;
  items: FeatureGridItem[];
};

export function FeatureGrid({ eyebrow, headline, items }: FeatureGridProps) {
  const hasHeader = Boolean(eyebrow || headline);
  const gridCols = getGridCols(items.length);

  return (
    <section className="py-20 sm:py-28 bg-card">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        {hasHeader && (
          <div className="text-center mb-16">
            {eyebrow && (
              <p className="text-[12px] font-bold uppercase tracking-wider text-accent-deep mb-4">
                {eyebrow}
              </p>
            )}
            {headline && (
              <h2 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.1] tracking-tight text-ink max-w-[40ch] mx-auto">
                {headline}
              </h2>
            )}
          </div>
        )}

        <div className={`grid ${gridCols} gap-x-6 gap-y-10`}>
          {items.map((item, i) => {
            const Icon = resolveIcon(item.icon);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="w-12 h-12 rounded-md bg-warm flex items-center justify-center mb-4">
                  <Icon
                    className="w-5 h-5 text-accent-deep"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-[14px] sm:text-[15px] font-bold text-ink leading-tight">
                  {item.label}
                </p>
                {item.description && (
                  <p className="text-[13px] text-muted mt-1 leading-relaxed">
                    {item.description}
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
