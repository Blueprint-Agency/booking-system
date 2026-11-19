import { ApiError, type Api } from "./api";
import { refusalMessage } from "./refusal-message";

/**
 * Entities: what a studio files its Class Types and packages under (Yoga,
 * Pilates). The settings screen lists them, makes, renames, reorders and
 * archives them (be-portal.md § entities.ts). Every package belongs to one, and
 * the package forms pick it (`components/packages/entity-picker.tsx`).
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

/**
 * An Entity as either portal reads it: the Admin's list carries everything
 * above; the Instructor catalog's (live Entities only) carries id, name, slug
 * and position, and no usage, which an Instructor has no use for.
 */
export type ApiEntityRead = Pick<ApiEntity, "id" | "name" | "slug"> & Partial<ApiEntity>;

export interface Entity {
  id: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  /** All zero where the read carries none (the Instructor catalog's). */
  inUse: EntityUsage;
}

const NO_USAGE: EntityUsage = { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 };

export function entityFromApi(e: ApiEntityRead): Entity {
  return { id: e.id, name: e.name, slug: e.slug, archivedAt: e.archived_at ?? null, inUse: e.in_use ?? NO_USAGE };
}

/** Where each portal reads the studio's Entities: an Instructor never calls an admin route. */
export const ENTITIES_PATH = {
  admin: "/portal/admin/entities",
  instructor: "/portal/instructor/catalog/entities",
} as const;
export type EntitiesSource = keyof typeof ENTITIES_PATH;

/** The studio's live Entities, in order; none when the read gave none. */
export function liveEntities(res: { entities: ApiEntityRead[] } | null): Entity[] {
  return (res?.entities ?? []).filter((e) => !e.archived_at).map(entityFromApi);
}

/** Reads the studio's live Entities, in display order, from the Admin's list or the Instructor's. */
export async function readEntities(api: Api, source: EntitiesSource = "admin"): Promise<Entity[]> {
  return liveEntities(await api.get<{ entities: ApiEntityRead[] }>(ENTITIES_PATH[source]));
}

/** Makes an Entity (the slug is made from the name when none is given) and answers with it. Throws the API's refusal. */
export async function postEntity(api: Api, input: { name: string; slug?: string }): Promise<Entity> {
  return entityFromApi(await api.post<ApiEntity>(ENTITIES_PATH.admin, input));
}

/**
 * The Entity filter value that means every Entity: no narrowing. The same on
 * the schedules, the finance page and the packages lists, so a filter that
 * hands its pick to a read treats the pick one way.
 */
export const ALL_ENTITIES = "";

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

/** An Entity filter (packages lists, schedules, Finance) is for a studio with two or more Entities; with one it would filter nothing. */
export function showEntityFilter(entities: readonly unknown[]): boolean {
  return entities.length >= 2;
}

/** The items in `entityId`, or all of them for ALL_ENTITIES (no filter). */
export function filterByEntity<T extends { entityId?: string | null }>(items: readonly T[], entityId: string): T[] {
  return entityId === ALL_ENTITIES ? [...items] : items.filter((item) => item.entityId === entityId);
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

/** What changing a Class Type's Entity reaches: `GET /portal/admin/class-types/:id/entity-preview`. */
export interface EntityMovePreview {
  upcoming_classes: number;
  bookings: number;
}

/**
 * The line the Class Type editor shows before a move is saved. Always says
 * nothing is cancelled: a move changes which packages pay for those classes
 * from now on, and cancels no booking.
 */
export function movePreviewSentence(preview: EntityMovePreview): string {
  const { upcoming_classes: classes, bookings } = preview;
  if (classes === 0 && bookings === 0) return "No upcoming classes or bookings are reached.";
  const c = `${classes} upcoming ${classes === 1 ? "class" : "classes"}`;
  const b = `${bookings} ${bookings === 1 ? "booking" : "bookings"}`;
  // A compound subject: "are", whatever the counts.
  return `${c} and ${b} are reached; nothing is cancelled.`;
}

/**
 * The body of a Class Type save. A sub-type shares its parent's Entity, so
 * `entity_id` is sent only for a top-level type: the server refuses one on a
 * sub-type, even the parent's own.
 */
export function classTypeBody(input: {
  name: string;
  description: string;
  difficulty: string;
  parentId: string | null;
  entityId: string | null;
}): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description.trim() ? input.description.trim() : null,
    difficulty: input.difficulty,
    parent_id: input.parentId,
    ...(input.parentId === null && input.entityId ? { entity_id: input.entityId } : {}),
  };
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
    case "entity_not_found":
      return "That entity is no longer there. Reload the page and choose another.";
    case "entity_archived":
      return "That entity is archived. Choose another.";
    case "class_type_entity_inherited":
      return "A sub-type shares its parent's entity. Change the parent's entity instead.";
    case "entity_order_invalid":
      return "The list changed while you were editing. Reload the page and try again.";
    default:
      return refusalMessage(err, fallback);
  }
}
