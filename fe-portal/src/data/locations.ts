import type { Location } from "@/types";

/**
 * FIXTURE ONLY — this names no studio.
 *
 * These used to be tenant #1's two real premises, with their real street
 * addresses, Google Maps links and front-desk phone numbers, sitting in a file
 * every studio's portal bundles. Invented ones carry the screens just as well,
 * and the live list comes from the backend per Tenant.
 */
export const locations: Location[] = [
  {
    id: "loc-riverside",
    name: "Riverside",
    address: "12 Riverside Walk, #03-02, Example City 100001",
    gmapsUrl: "https://maps.google.com/?q=Riverside+Walk",
    phone: "+65 6000 0001",
    archivedAt: null,
  },
  {
    id: "loc-eastgate",
    name: "Eastgate",
    address: "88 Eastgate Avenue, #02-11, Example City 100002",
    gmapsUrl: "https://maps.google.com/?q=Eastgate+Avenue",
    phone: "+65 6000 0002",
    archivedAt: null,
  },
];
