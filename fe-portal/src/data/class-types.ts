import type { ClassType } from "@/types";

export const classTypes: ClassType[] = [
  {
    id: "ct-vinyasa",
    name: "Vinyasa Flow",
    description: "Dynamic linked-breath flow.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-yin",
    name: "Yin Yoga",
    description: "Long-held passive postures targeting connective tissue.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-aerial",
    name: "Aerial Yoga",
    description: "Yoga with silk hammocks for support and inversion play.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-aerial-fdn",
    name: "Aerial Foundations",
    description: "Intro to aerial — beginner-friendly hammock basics.",
    parentId: "ct-aerial",
    archivedAt: null,
  },
  {
    id: "ct-aerial-flow",
    name: "Aerial Flow",
    description: "Continuous aerial sequences and transitions.",
    parentId: "ct-aerial",
    archivedAt: null,
  },
  {
    id: "ct-chair",
    name: "Chair Yoga",
    description: "Seated practice, accessible to all mobility levels.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-prenatal",
    name: "Prenatal Yoga",
    description: "Gentle practice for expecting mothers.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-hatha",
    name: "Hatha",
    description: "Foundational alignment-based yoga.",
    parentId: null,
    archivedAt: null,
  },
  {
    id: "ct-power",
    name: "Power Yoga",
    description: "High-intensity vinyasa.",
    parentId: null,
    archivedAt: "2026-01-15T08:00:00.000Z",
  },
];
