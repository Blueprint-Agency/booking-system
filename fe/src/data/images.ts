/**
 * Phase A image manifest. Curated 15-image Unsplash set for the prototype
 * + slots reserved for client-supplied photography (Yoga Sadhana studios,
 * instructors). All Unsplash URLs use the public CDN with width hints;
 * no API key required.
 *
 * Each entry pairs a stable key with both a Unsplash CDN URL (used now)
 * and a local-asset path (used once images are downloaded into
 * /public/images/). Phase B components import from this manifest only.
 */

export type ImageEntry = {
  key: string;
  alt: string;
  /** Unsplash hosted URL for prototype use. */
  unsplash: string;
  /** Local path under /public once asset is downloaded. */
  local: string;
  /** Tag for filtering by section purpose. */
  category: "hero" | "category" | "cta" | "auth" | "studio" | "instructor";
};

// ── Yoga Sadhana WP CDN helper ────────────────────────────────────────────────
const YS = (path: string, w = 1920) =>
  `https://i0.wp.com/yogasadhana.sg/wp-content/uploads/${path}?fit=${w}%2C${Math.round(w * 0.667)}&ssl=1`;

export const IMAGES: ImageEntry[] = [
  // Hero-grade lifestyle (4) — real Yoga Sadhana studio photography
  { key: "hero-yoga-01",       alt: "Yoga Sadhana flexibility & stretch class",        unsplash: "https://i0.wp.com/yogasadhana.sg/wp-content/uploads/2025/03/2024YogaSadhana182.jpg?resize=2048%2C1365&ssl=1", local: "/images/hero-yoga-01.jpg",       category: "hero" },
  { key: "hero-pilates-01",    alt: "Ashtanga practice at Yoga Sadhana",               unsplash: YS("2025/03/2024YogaSadhana299.jpg", 1920),                local: "/images/hero-pilates-01.jpg",    category: "hero" },
  { key: "hero-studio-01",     alt: "Yoga Sadhana studio interior",                    unsplash: YS("2025/03/IMG_9518.jpg", 1920),                          local: "/images/hero-studio-01.jpg",     category: "hero" },
  { key: "hero-meditation-01", alt: "Yoga Sadhana group class",                        unsplash: YS("2025/03/IMG_9530.jpg", 1920),                          local: "/images/hero-meditation-01.jpg", category: "hero" },

  // Category showcase (4) — class styles from the official site
  { key: "cat-yoga",           alt: "Hatha yoga practice",                             unsplash: YS("2025/03/IMG_9530.jpg", 1200),                          local: "/images/cat-yoga.jpg",           category: "category" },
  { key: "cat-pilates",        alt: "Flexibility and stretch class",                   unsplash: YS("2025/03/2024YogaSadhana182.jpg", 1200),                local: "/images/cat-pilates.jpg",        category: "category" },
  { key: "cat-meditation",     alt: "Vinyasa flow class",                              unsplash: YS("2025/03/2024YogaSadhana148.jpg", 1200),                local: "/images/cat-meditation.jpg",     category: "category" },
  { key: "cat-workshop",       alt: "Inversion workshop",                              unsplash: YS("2025/03/IMG_9508.jpg", 1200),                          local: "/images/cat-workshop.jpg",       category: "category" },

  // CTA banners (4)
  { key: "cta-evening",        alt: "Evening session at Yoga Sadhana",                 unsplash: YS("2025/03/IMG_9518.jpg", 1920),                          local: "/images/cta-evening.jpg",        category: "cta" },
  { key: "cta-morning",        alt: "Morning light in the studio",                     unsplash: YS("2025/03/IMG_9530.jpg", 1920),                          local: "/images/cta-morning.jpg",        category: "cta" },
  { key: "cta-community",      alt: "Yoga Sadhana community in practice",              unsplash: YS("2025/03/IMG_9512.jpg", 1920),                          local: "/images/cta-community.jpg",      category: "cta" },
  { key: "cta-quiet",          alt: "Quiet studio moment",                             unsplash: YS("2025/03/2024YogaSadhana148.jpg", 1920),                local: "/images/cta-quiet.jpg",          category: "cta" },

  // Auth split-screen (3)
  { key: "auth-calm-01",       alt: "Master Vishal in practice",                       unsplash: YS("2025/03/2024YogaSadhana022.jpg", 1200),                local: "/images/auth-calm-01.jpg",       category: "auth" },
  { key: "auth-calm-02",       alt: "Yoga Sadhana studio interior",                    unsplash: YS("2025/03/IMG_9518.jpg", 1200),                          local: "/images/auth-calm-02.jpg",       category: "auth" },
  { key: "auth-calm-03",       alt: "Master Sumit teaching",                           unsplash: YS("2025/03/2024YogaSadhana789.jpg", 1200),                local: "/images/auth-calm-03.jpg",       category: "auth" },

  // Instructor headshots — portraits from the site
  { key: "instr-vishal",       alt: "Master Vishal",                                   unsplash: YS("2025/03/2024YogaSadhana022.jpg", 819),                 local: "/images/instr-vishal.jpg",       category: "instructor" },
  { key: "instr-sumit",        alt: "Master Sumit",                                    unsplash: YS("2025/03/2024YogaSadhana789.jpg", 819),                 local: "/images/instr-sumit.jpg",        category: "instructor" },
  { key: "instr-tiffany",      alt: "Tiffany Lee",                                     unsplash: YS("2025/03/WhatsApp-Image-2568-03-07-at-19.41.26.jpeg", 819), local: "/images/instr-tiffany.jpg",  category: "instructor" },
];

/**
 * Placeholder slots — to be filled with client-supplied photography.
 * Each slot has an Unsplash fallback so the prototype renders today.
 */
export const PLACEHOLDER_SLOTS = {
  studioCover: { fallback: "hero-studio-01", note: "Yoga Sadhana studio cover image (replace with actual Breadtalk IHQ shot)" },
  studioInteriorBreadtalk: { fallback: "hero-studio-01", note: "Breadtalk IHQ studio interior" },
  studioInteriorOutram: { fallback: "hero-yoga-01", note: "Outram Park studio interior" },
  instructorPlaceholder: { fallback: "cat-meditation", note: "Yoga Sadhana instructor headshots (4 needed)" },
} as const;

/** Helper: get image by key. Throws if unknown. */
export function img(key: string): ImageEntry {
  const found = IMAGES.find((i) => i.key === key);
  if (!found) throw new Error(`Unknown image key: ${key}`);
  return found;
}

/** Helper: filter by category. */
export function imgsByCategory(category: ImageEntry["category"]): ImageEntry[] {
  return IMAGES.filter((i) => i.category === category);
}
