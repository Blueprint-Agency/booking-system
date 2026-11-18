import { ApiError } from "./api";
import { refusalMessage } from "./refusal-message";

/**
 * Entities: the lines of practice a studio sells packages for (Yoga, Pilates).
 * The settings screen lists them, makes, renames, reorders and archives them
 * (be-portal.md § entities.ts). Every package belongs to one, and the package
 * forms pick it (`components/packages/entity-picker.tsx`).
 */

export interface EntityUsage {
  class_types: number;
  class_packages: number;
  pt_packages: number;
  corporate_packages: number;
}

export interface ApiEntity {
  id: string;
  name: string;
  slug: string;
  position: number;
  archived_at: string | null;
  in_use: EntityUsage;
}

export interface Entity {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  inUse: EntityUsage;
}

export function entityFromApi(e: ApiEntity): Entity {
  return { id: e.id, name: e.name, slug: e.slug, archivedAt: e.archived_at, inUse: e.in_use };
}

/**
 * What a package row says about the Entity it belongs to. Both optional, as
 * every new response field is: the portal and the API deploy apart, so a row
 * from a build that predates Entities carries neither.
 */
export interface PackageEntityFields {
  entity_id?: string | null;
  entity?: { id: string; name: string; slug: string } | null;
}

export function packageEntityFromApi(r: PackageEntityFields): { entityId: string | null; entityName: string | null } {
  return { entityId: r.entity_id ?? null, entityName: r.entity?.name ?? null };
}

/** The Entity filter on a packages list is for a studio with more than one line; with one it would filter nothing. */
export function showEntityFilter(entities: readonly unknown[]): boolean {
  return entities.length >= 2;
}

/** The items in `entityId`, or all of them for "" (no filter). */
export function filterByEntity<T extends { entityId?: string | null }>(items: readonly T[], entityId: string): T[] {
  return entityId === "" ? [...items] : items.filter((item) => item.entityId === entityId);
}

/** The Entity a new package starts in: the studio's first, in its display order. "" when the list has none yet. */
export function defaultEntityId(entities: readonly { id: string }[]): string {
  return entities[0]?.id ?? "";
}

/** What the form says before a package is moved to another Entity, so the admin knows who it takes along. */
export function moveNotice(membersHolding: number): string {
  if (membersHolding === 0) return "No member holds this package, so nobody is affected by the move.";
  const who = membersHolding === 1 ? "1 member holds" : `${membersHolding} members hold`;
  return `${who} this package. It moves with it, and nothing is cancelled.`;
}

/** The ids with the one at `index` swapped with its neighbour; unchanged at either end. */
export function moveInOrder(ids: readonly string[], index: number, direction: "up" | "down"): string[] {
  const to = direction === "up" ? index - 1 : index + 1;
  const next = [...ids];
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return next;
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** The slug the server makes from a name, so the form can show the address a new Entity will get. */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const KINDS: { key: keyof EntityUsage; one: string; many: string }[] = [
  { key: "class_types", one: "class type", many: "class types" },
  { key: "class_packages", one: "class package", many: "class packages" },
  { key: "pt_packages", one: "private session package", many: "private session packages" },
  { key: "corporate_packages", one: "corporate package", many: "corporate packages" },
];

/** What still belongs to an Entity, in words ("2 class types, 1 class package"); empty when nothing does. */
export function usageSentence(usage: EntityUsage): string {
  return KINDS.filter((k) => usage[k.key] > 0)
    .map((k) => `${usage[k.key]} ${usage[k.key] === 1 ? k.one : k.many}`)
    .join(", ");
}

/** What a refused Entity save or archive shows: a sentence for each refusal the screen can get. */
export function entityRefusal(err: unknown, fallback: string): string {
  const body = err instanceof ApiError ? (err.body as ({ error?: string } & Partial<EntityUsage>) | null) : null;
  switch (body?.error) {
    case "entity_name_taken":
      return "Another entity already has that name.";
    case "entity_slug_taken":
      return "Another entity already uses that address. Choose a different one.";
    case "entity_slug_invalid":
      return "The address can use only lowercase letters, numbers and hyphens, like pilates or hot-yoga.";
    case "cannot_archive_last_entity":
      return "A studio needs at least one entity, so the last one can't be archived.";
    case "entity_in_use": {
      const used = usageSentence({
        class_types: body.class_types ?? 0,
        class_packages: body.class_packages ?? 0,
        pt_packages: body.pt_packages ?? 0,
        corporate_packages: body.corporate_packages ?? 0,
      });
      return `Still in use by ${used}. Move them to another entity first.`;
    }
    case "entity_order_invalid":
      return "The list changed while you were editing. Reload the page and try again.";
    case "entity_archived":
      return "That entity is archived. Pick another one.";
    case "entity_not_found":
      return "That entity no longer exists. Reload the page and pick another.";
    default:
      return refusalMessage(err, fallback);
  }
}
