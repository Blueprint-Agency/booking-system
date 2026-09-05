"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { ApiError, makeApi, type Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { useActiveOrganization } from "@/lib/use-active-organization";
import type { Location, StaffRole, StaffUser } from "@/types";

export const STORAGE_KEY_LOC = "ys.activeLocationId";

interface AuthMePayload {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  status: "pending" | "active" | "archived";
  is_seeded_superadmin: boolean;
  granted_location_ids: string[];
  locations: Array<{ id: string; name: string; address: string | null }>;
}

interface LocationApiRow {
  id: string;
  name: string;
  address: string | null;
  gmaps_url: string | null;
  phone: string | null;
  archived_at: string | null;
}

function locationFromApi(row: LocationApiRow): Location {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? "",
    gmapsUrl: row.gmaps_url ?? "",
    phone: row.phone ?? "",
    archivedAt: row.archived_at,
  };
}

interface WorkspaceContextValue {
  loading: boolean;
  currentStaff: StaffUser | null;
  role: StaffRole | null;
  locations: Location[]; // all locations (incl archived) for superadmin views
  accessibleLocations: Location[];
  activeLocation: Location | null;
  activeLocationId: string | null;
  setActiveLocationId: (id: string) => void;
  // Location CRUD passthroughs — call backend then refresh.
  addLocation: (loc: Location) => Promise<void> | void;
  updateLocation: (loc: Location) => Promise<void> | void;
  // false when the admin backed out of the strand warning.
  archiveLocation: (id: string) => Promise<boolean>;
  restoreLocation: (id: string) => Promise<void> | void;
  // Kept for compat with DevRoleSwitcher (now a no-op — real auth via Clerk).
  switchStaff: (id: string) => void;
  updateStaffGrants: (ids: string[]) => void;
  allStaff: StaffUser[]; // unused in prod; kept for DevRoleSwitcher compat
  api: Api | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();

  // The token has to carry this studio's Clerk organization before the first
  // call, or the backend answers 403 and `loadMe` below reads that as "no staff
  // row" and signs the user straight back out. See `active-organization.ts`.
  const orgStatus = useActiveOrganization(isLoaded && isSignedIn === true);

  const [loading, setLoading] = useState(true);
  const [currentStaff, setCurrentStaff] = useState<StaffUser | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationIdState] = useState<string | null>(
    null,
  );

  // Bound API instance — stable for the provider's lifetime.
  const api = useMemo<Api | null>(() => {
    if (!isLoaded || !isSignedIn) return null;
    return makeApi(() => getToken());
  }, [isLoaded, isSignedIn, getToken]);

  // Hydrate activeLocationId from localStorage on mount (workspace selection
  // persists across reloads — it's a fe-only concern).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY_LOC);
    if (saved) setActiveLocationIdState(saved);
  }, []);

  const loadMe = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const me = await api.get<AuthMePayload>("/portal/auth/me");
      const accessible = me.locations.map(l => ({
        id: l.id,
        name: l.name,
        address: l.address ?? "",
        gmapsUrl: "",
        phone: "",
        archivedAt: null as string | null,
      }));
      setCurrentStaff({
        id: me.id,
        name: me.name,
        email: me.email,
        role: me.role,
        status: me.status,
        isSeededSuperadmin: me.is_seeded_superadmin === true,
        grantedLocationIds: me.granted_location_ids,
      });
      setLocations(accessible);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // Clerk session exists but no staff_users row, or staff archived/pending.
        // Clear the persisted workspace so the next user on this browser doesn't
        // inherit a stale active location.
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEY_LOC);
        }
        await signOut(() => router.push("/login"));
        return;
      }
      // Network or unexpected — leave staff null so UI shows error/empty
      // state. Re-thrown errors here would crash the whole admin app.
      reportError(err, { scope: "workspace-auth-me" });
    } finally {
      setLoading(false);
    }
  }, [api, router, signOut]);

  // Once Clerk + API are ready, fetch /auth/me. Held back until the active
  // organization has settled — `settling` is the window in which a request
  // would be refused for carrying no organization claim yet, and this provider
  // answers a refusal by signing out.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      setCurrentStaff(null);
      setLocations([]);
      return;
    }
    // `unavailable` still goes through: the backend is the authority on whether
    // this account may be here, and its refusal is the honest answer.
    if (orgStatus === "settling") return;
    void loadMe();
  }, [isLoaded, isSignedIn, orgStatus, loadMe]);

  // For superadmin, additionally fetch ALL locations (incl. archived) so the
  // Locations page + manage dialog can render archived rows.
  const refreshAllLocations = useCallback(async () => {
    if (!api || !currentStaff || currentStaff.role !== "superadmin") return;
    try {
      const data = await api.get<{ locations: LocationApiRow[] }>(
        "/portal/admin/locations",
        { include_archived: "true" },
      );
      setLocations(data.locations.map(locationFromApi));
    } catch (err) {
      reportError(err, { scope: "workspace-all-locations" });
    }
  }, [api, currentStaff]);

  useEffect(() => {
    void refreshAllLocations();
  }, [refreshAllLocations]);

  const accessibleLocations = useMemo(() => {
    const active = locations.filter(l => !l.archivedAt);
    if (!currentStaff) return [];
    // Empty grants = "all active locations" — matches the BE /auth/me rule.
    // This covers superadmin AND instructors (who carry no location grants);
    // without it an instructor resolves to zero workspaces and a dead shell.
    if (
      currentStaff.role === "superadmin" ||
      currentStaff.grantedLocationIds.length === 0
    )
      return active;
    return active.filter(l => currentStaff.grantedLocationIds.includes(l.id));
  }, [locations, currentStaff]);

  // Keep activeLocationId valid as accessible locations change.
  useEffect(() => {
    if (loading) return;
    const valid =
      activeLocationId && accessibleLocations.some(l => l.id === activeLocationId);
    if (!valid) {
      const next = accessibleLocations[0]?.id ?? null;
      setActiveLocationIdState(next);
      if (typeof window !== "undefined") {
        if (next) window.localStorage.setItem(STORAGE_KEY_LOC, next);
        else window.localStorage.removeItem(STORAGE_KEY_LOC);
      }
    }
  }, [loading, accessibleLocations, activeLocationId]);

  const setActiveLocationId = useCallback((id: string) => {
    setActiveLocationIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_LOC, id);
    }
  }, []);

  // Mutations — round-trip via API, then refresh state from server.
  const addLocation = useCallback(
    async (loc: Location) => {
      if (!api) return;
      await api.post("/portal/admin/locations", {
        name: loc.name,
        address: loc.address || null,
        gmaps_url: loc.gmapsUrl || null,
        phone: loc.phone || null,
      });
      await refreshAllLocations();
    },
    [api, refreshAllLocations],
  );

  const updateLocation = useCallback(
    async (loc: Location) => {
      if (!api) return;
      await api.patch(`/portal/admin/locations/${loc.id}`, {
        name: loc.name,
        address: loc.address || null,
        gmaps_url: loc.gmapsUrl || null,
        phone: loc.phone || null,
      });
      await refreshAllLocations();
    },
    [api, refreshAllLocations],
  );

  // Story 133: name what archiving strands before it happens. Here rather than
  // in the pages so both archive buttons (this dialog and the Locations page)
  // warn identically. Returns false when the admin backs out.
  const archiveLocation = useCallback(
    async (id: string) => {
      if (!api) return false;
      const loc = locations.find(l => l.id === id);
      // The warning is informational — if the count can't be read, archiving
      // still goes ahead rather than being blocked by it.
      const count = await api
        .get<{ count: number }>(`/portal/admin/locations/${id}/live-unlimited-count`)
        .then(r => r.count)
        .catch(() => 0);
      if (
        count > 0 &&
        !window.confirm(
          `${count} live Unlimited ${count === 1 ? "Plan calls" : "Plans call"} ` +
            `${loc?.name ?? "this location"} home. Archiving it strands ` +
            `${count === 1 ? "that member" : "those members"}. Archive anyway?`,
        )
      ) {
        return false;
      }
      await api.post(`/portal/admin/locations/${id}/archive`);
      await refreshAllLocations();
      return true;
    },
    [api, locations, refreshAllLocations],
  );

  const restoreLocation = useCallback(
    async (id: string) => {
      if (!api) return;
      await api.post(`/portal/admin/locations/${id}/unarchive`);
      await refreshAllLocations();
    },
    [api, refreshAllLocations],
  );

  // Compat no-ops (real auth lives in Clerk; the DevRoleSwitcher was a v0
  // affordance only).
  const switchStaff = useCallback(() => {}, []);
  const updateStaffGrants = useCallback(() => {}, []);

  const activeLocation = useMemo(
    () => accessibleLocations.find(l => l.id === activeLocationId) ?? null,
    [accessibleLocations, activeLocationId],
  );

  const value: WorkspaceContextValue = {
    loading,
    currentStaff,
    role: currentStaff?.role ?? null,
    locations,
    accessibleLocations,
    activeLocation,
    activeLocationId,
    setActiveLocationId,
    addLocation,
    updateLocation,
    archiveLocation,
    restoreLocation,
    switchStaff,
    updateStaffGrants,
    allStaff: currentStaff ? [currentStaff] : [],
    api,
    refresh: loadMe,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
