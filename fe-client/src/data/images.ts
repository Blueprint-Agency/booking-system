/**
 * The neutral imagery the app falls back to, and nothing more.
 *
 * A studio's own photography is **not** here — it is that studio's, so it lives
 * on its Tenant settings (`og_image_url`) and is read through `useBrand()`. This
 * manifest is what renders for a studio that has supplied none: stock images
 * that belong to no studio, name no premises and imply no location.
 *
 * That split is the point of #66. When these entries carried one studio's
 * WordPress CDN URLs, every other studio's sign-in page showed that studio's
 * rooms — which is worse than a generic photograph, not better.
 *
 * Each entry pairs a stable key with a hosted URL (used now) and a local-asset
 * path (used once assets are downloaded into /public/images/).
 */

export type ImageEntry = {
  key: string;
  alt: string;
  /** Hosted URL. Stock, and deliberately unattributable to any studio. */
  unsplash: string;
  /** Local path under /public once the asset is downloaded. */
  local: string;
  /** Tag for filtering by section purpose. */
  category: "hero" | "category" | "cta" | "auth" | "studio" | "instructor";
};

/** Unsplash CDN with a width hint; no API key required. */
const U = (id: string, w = 1920) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const IMAGES: ImageEntry[] = [
  // Hero-grade lifestyle — the sign-in and registration splits.
  { key: "hero-yoga-01",       alt: "A yoga class in a bright studio", unsplash: U("1544367567-0f2fcb009e0b"),       local: "/images/hero-yoga-01.jpg",       category: "hero" },
  { key: "hero-pilates-01",    alt: "A stretch and flexibility class", unsplash: U("1518611012118-696072aa579a"),    local: "/images/hero-pilates-01.jpg",    category: "hero" },
  { key: "hero-studio-01",     alt: "A quiet studio interior",         unsplash: U("1506126613408-eca07ce68773"),    local: "/images/hero-studio-01.jpg",     category: "hero" },
  { key: "hero-meditation-01", alt: "A group class in session",        unsplash: U("1545205597-3d9d02c29597"),       local: "/images/hero-meditation-01.jpg", category: "hero" },

  // Category tiles.
  { key: "cat-pilates",        alt: "A flexibility and stretch class", unsplash: U("1518611012118-696072aa579a", 1200), local: "/images/cat-pilates.jpg",     category: "category" },
  { key: "cat-meditation",     alt: "A vinyasa flow class",            unsplash: U("1545205597-3d9d02c29597", 1200),    local: "/images/cat-meditation.jpg",  category: "category" },

  // Calls to action.
  { key: "cta-evening",        alt: "An evening session",              unsplash: U("1506126613408-eca07ce68773"),    local: "/images/cta-evening.jpg",        category: "cta" },
  { key: "cta-community",      alt: "A community in practice",         unsplash: U("1571019613454-1cb2f99b2d8b"),    local: "/images/cta-community.jpg",      category: "cta" },
  { key: "cta-quiet",          alt: "A quiet studio moment",           unsplash: U("1545205597-3d9d02c29597"),       local: "/images/cta-quiet.jpg",          category: "cta" },
];

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
