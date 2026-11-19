/**
 * An Entity as a class names it (`entity` on a class card and detail): the line
 * of practice whose packages can pay for it — Yoga, Pilates (be/CONTEXT.md § Entity).
 * Absent from a backend that predates Entities, and null on a class whose Class
 * Type has none, so every reader treats it as optional.
 */
export interface ApiEntityRef {
  id: string;
  name: string;
  slug: string;
}

/**
 * Where "buy a package" goes for a class of this Entity: that Entity's own
 * Packages page (`/packages/<slug>`), or `/packages` for a class with none.
 * One helper, shared with the Packages menu, so every link agrees.
 */
export { packagesHref } from "./entities.ts";
