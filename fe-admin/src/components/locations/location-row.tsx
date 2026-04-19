"use client";

import type { Location } from "@/types";
import { Button } from "@/components/ui/button";

export function LocationRow({
  location,
  onEdit,
}: {
  location: Location;
  onEdit: (l: Location) => void;
}) {
  return (
    <tr className="border-t border-ink/5">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{location.name}</div>
        <div className="text-xs text-ink/50">{location.shortName}</div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.address}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.area}</td>
      <td className="px-4 py-3 font-mono text-sm text-ink/70">{location.rooms ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-ink/70">{location.amenities?.join(", ") ?? "—"}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(location)}>Edit</Button>
      </td>
    </tr>
  );
}
