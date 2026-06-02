"use client";

import { useSyncExternalStore } from "react";

// Local-only mock store for PT requests. BE submit/cancel are still 501 (see
// be-client.md §PT / be-portal.md §PT) — this module lets the FE render the
// new request UX end-to-end against localStorage until those routes go live.

export type LocalPtRequestStatus =
  | "pending"
  | "scheduled"
  | "cancelled_before_scheduled"
  | "cancelled_after_scheduled"
  | "attended";

export type LocalPtRequestSlot = {
  proposedDate: string; // YYYY-MM-DD
  startTime: string;    // HH:mm
  endTime: string;      // HH:mm
};

export type LocalPtRequestPartner =
  | { kind: "existing"; coClientId: string; name: string }
  | { kind: "new"; name: string; email: string };

export type LocalPtRequest = {
  id: string;
  classTypeId: string;
  className: string;
  // Studio location the client wants the session at — picked at request time.
  locationId: string;
  locationName: string;
  sessionType: "1on1" | "2on1";
  slots: LocalPtRequestSlot[];
  message: string;
  partner: LocalPtRequestPartner | null;
  status: LocalPtRequestStatus;
  createdAt: string;
  // Stamped when admin schedules from the portal — mocked here for preview.
  scheduled?: {
    date: string;
    startTime: string;
    endTime: string;
    locationName: string;
    instructorName: string;
  };
};

const KEY = "ys.pt-requests.v1";
const isBrowser = typeof window !== "undefined";
const listeners = new Set<() => void>();
let snapshot: LocalPtRequest[] = load();

function load(): LocalPtRequest[] {
  if (!isBrowser) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalPtRequest[]) : [];
  } catch {
    return [];
  }
}

function persist(next: LocalPtRequest[]) {
  snapshot = next;
  if (isBrowser) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota — fall through, in-memory snapshot still valid */
    }
  }
  for (const l of listeners) l();
}

export function usePtRequests(): LocalPtRequest[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => [],
  );
}

export function submitPtRequest(input: Omit<LocalPtRequest, "id" | "status" | "createdAt">): LocalPtRequest {
  const row: LocalPtRequest = {
    ...input,
    id: `req-${Date.now().toString(36)}`,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  persist([row, ...snapshot]);
  return row;
}

export function cancelPtRequest(id: string): void {
  persist(
    snapshot.map((r) =>
      r.id === id
        ? {
            ...r,
            status:
              r.status === "scheduled"
                ? ("cancelled_after_scheduled" as const)
                : ("cancelled_before_scheduled" as const),
          }
        : r,
    ),
  );
}

// Mock partner lookup — pretends every email except `nobody@nowhere.test` is
// not a member. Replace with a real call to /me/pt-sessions/partner-lookup
// when the BE lands.
const KNOWN_MEMBERS: Record<string, { clientId: string; name: string }> = {
  "amelia.koh@example.com": { clientId: "cli-amelia", name: "Amelia Koh" },
  "rahul.menon@example.com": { clientId: "cli-rahul", name: "Rahul Menon" },
};

export function mockPartnerLookup(email: string): { found: boolean; clientId?: string; name?: string } {
  const hit = KNOWN_MEMBERS[email.trim().toLowerCase()];
  return hit ? { found: true, clientId: hit.clientId, name: hit.name } : { found: false };
}
