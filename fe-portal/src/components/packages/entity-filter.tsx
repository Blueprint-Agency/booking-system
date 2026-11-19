"use client";
import { Badge, Select } from "@/components/ui";
import { showEntityFilter, type Entity } from "@/lib/entities";

/**
 * The Entity filter above a packages list. Hidden for a studio with one Entity,
 * where it would filter nothing; `value` "" is every Entity.
 */
export function EntityFilter({
  entities,
  value,
  onChange,
}: {
  entities: readonly Entity[];
  value: string;
  onChange: (entityId: string) => void;
}) {
  if (!showEntityFilter(entities)) return null;
  return (
    <Select
      aria-label="Filter by entity"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mb-4 w-full sm:w-56"
    >
      <option value="">All entities</option>
      {entities.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </Select>
  );
}

/** The Entity a package belongs to, on its card. Nothing for a row that names none. */
export function EntityBadge({ name }: { name: string | null | undefined }) {
  if (!name) return null;
  return <Badge tone="accent">{name}</Badge>;
}
