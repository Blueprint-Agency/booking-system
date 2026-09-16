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
import { usePathname, useRouter } from "next/navigation";
import { AccessDenied } from "@/components/auth/access-denied";
import { authFailure } from "@/lib/access-refusal";
import { ApiError, makeApi, type Api } from "@/lib/api";
import { reportError } from "@/lib/report-error";
import { sessionTenantRefusal } from "@/lib/session-tenant";
import { getPortalToken, signOutPortal, usePortalSession } from "@/lib/portal-auth";
import type { Location, StaffRole, StaffUser } from "@/types";

/**
 * Namespaced for the platform, not for tenant #1 — this was `ys.`, Yoga
 * Sadhana's initials, on every studio's portal. Isolation was never at stake
 * (each studio is its own origin, so its `localStorage` is its own), but the
 * name was one studio's on all of them. Renaming drops whatever location a
 * browser had remembered, which the picker re-asks for on the next visit.
 */
export const STORAGE_KEY_LOC = "rt.activeLocationId";

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
  // Kept for compat with DevRoleSwitcher (now a no-op — real auth is the staff session).
  switchStaff: (id: string) => void;
  updateStaffGrants: (ids: string[]) => void;
  allStaff: StaffUser[]; // unused in prod; kept for DevRoleSwitcher compat
  api: Api | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * The signed-in staff member at this studio, and the gate in front of every
 * studio page.
 *
 * **This is the gate.** The Next proxy cannot see a bearer token, so it lets
 * every studio route through; here, no session means `/login?next=…`, and a
 * session is only used once it is known to belong to this studio.
 *
 * `hostTenantId` is the studio the hostname resolved to, read by the layout off
 * the header the proxy set — the one input this needs that a client component
 * cannot work out for itself.
 */
export function WorkspaceProvider({
  children,
  hostTenantId,
}: {
  children: ReactNode;
  hostTenantId: string | null;
}) {
  const { isLoaded, session } = usePortalSession();
  const isSignedIn = session !== null;
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  /**
   * The backend's refusal code, when it has told us this session may not be
   * here. Held rather than acted on: a 403 is an answer about *this account on
   * this hostname*, not a reason to destroy a session that is valid elsewhere.
   */
  const [denied, setDenied] = useState<{ reason: string | null } | null>(null);
  const [currentStaff, setCurrentStaff] = useState<StaffUser | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationIdState] = useState<string | null>(
    null,
  );

  // Bound API instance — stable for as long as someone is signed in.
  const api = useMemo<Api | null>(() => {
    if (!isLoaded || !isSignedIn) return null;
    return makeApi(getPortalToken);
  }, [isLoaded, isSignedIn]);

  const claimedTenantId = session?.claimedTenantId ?? null;
  // Worked out before any request: a session signed in at another studio would
  // only be refused, so it goes straight to the screen that says so.
  const tenantRefusal = isSignedIn
    ? sessionTenantRefusal({ hostTenantId, claimedTenantId })
    : null;

  const signOutToLogin = useCallback(async () => {
    try {
      await signOutPortal();
    } finally {
      router.push("/login");
    }
  }, [router]);

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
      setDenied(null);
    } catch (err) {
      const failure =
        err instanceof ApiError
          ? authFailure(err.status, err.body)
          : ({ kind: "other" } as const);

      if (failure.kind !== "other") {
        // Whichever way this went, the workspace this browser remembered was
        // the previous account's. Clearing it stops the next one inheriting it.
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEY_LOC);
        }
      }
      if (failure.kind === "sign-out") {
        // The token is dead — signed out elsewhere, expired, or ended when the
        // account was archived. Forget it here too, or the login page would
        // hand the same dead token straight back.
        await signOutToLogin();
        return;
      }
      if (failure.kind === "denied") {
        setDenied({ reason: failure.reason });
        setCurrentStaff(null);
        setLocations([]);
        return;
      }
      // Network or unexpected — leave staff null so UI shows error/empty
      // state. Re-thrown errors here would crash the whole admin app.
      reportError(err, { scope: "workspace-auth-me" });
    } finally {
      setLoading(false);
    }
  }, [api, signOutToLogin]);

  // Once the session is known, fetch /auth/me — or send a signed-out visitor to
  // sign in, remembering where they were going.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      setCurrentStaff(null);
      setLocations([]);
      setDenied(null);
      const next = `${pathname ?? ""}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (tenantRefusal) {
      setLoading(false);
      setCurrentStaff(null);
      setLocations([]);
      setDenied({ reason: tenantRefusal });
      return;
    }
    void loadMe();
    // `pathname` is read, not watched: moving between pages while signed out is
    // already a redirect, and re-running the load on every navigation is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, tenantRefusal, loadMe, router]);

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

  // The way out of a refusal that was never about the account: a suspended
  // studio can reopen without the session changing.
  const retryAfterDenial = useCallback(() => {
    setDenied(null);
    void loadMe();
  }, [loadMe]);

  // Compat no-ops (real auth is the staff session; the DevRoleSwitcher was a v0
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

  // Replaces the shell rather than rendering inside it: every page under this
  // provider assumes a staff row, and there isn't one.
  if (denied) {
    return (
      <AccessDenied
        email={session?.email ?? null}
        reason={denied.reason}
        onRetry={retryAfterDenial}
        onSignOut={signOutToLogin}
      />
    );
  }

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
