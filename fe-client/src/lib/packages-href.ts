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
 * Where "buy a package" goes for a class of this Entity. The member Packages
 * page is read one Entity at a time (`/packages/<slug>`), but until that page
 * exists the one `/packages` page is the whole catalogue, so every link a class
 * offers goes through here and switches over in this one place.
 */
export function packagesHref(entity?: Pick<ApiEntityRef, "slug"> | null): string {
  void entity;
  return "/packages";
}
