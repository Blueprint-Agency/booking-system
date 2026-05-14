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
import {
  locations as seedLocations,
  staffUsers as seedStaff,
  defaultStaffId,
} from "@/data";
import type { Location, StaffRole, StaffUser } from "@/types";

const STORAGE_KEY_STAFF = "ys.devCurrentStaffId";
const STORAGE_KEY_LOC = "ys.activeLocationId";

interface WorkspaceContextValue {
  currentStaff: StaffUser;
  role: StaffRole;
  locations: Location[];
  accessibleLocations: Location[];
  activeLocation: Location | null;
  activeLocationId: string | null;
  setActiveLocationId: (id: string) => void;
  addLocation: (loc: Location) => void;
  updateLocation: (loc: Location) => void;
  archiveLocation: (id: string) => void;
  restoreLocation: (id: string) => void;
  switchStaff: (id: string) => void;
  updateStaffGrants: (ids: string[]) => void;
  allStaff: StaffUser[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [staffList, setStaffList] = useState<StaffUser[]>(seedStaff);
  const [currentStaffId, setCurrentStaffId] = useState<string>(defaultStaffId);
  const [locations, setLocations] = useState<Location[]>(seedLocations);
  const [activeLocationId, setActiveLocationIdState] = useState<string | null>(
    null
  );
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    const savedStaff = window.localStorage.getItem(STORAGE_KEY_STAFF);
    if (savedStaff && seedStaff.some((s) => s.id === savedStaff)) {
      setCurrentStaffId(savedStaff);
    }
    const savedLoc = window.localStorage.getItem(STORAGE_KEY_LOC);
    if (savedLoc) setActiveLocationIdState(savedLoc);
    setHydrated(true);
  }, []);

  const currentStaff = useMemo(
    () => staffList.find((s) => s.id === currentStaffId) ?? staffList[0],
    [staffList, currentStaffId]
  );

  const accessibleLocations = useMemo(() => {
    const active = locations.filter((l) => !l.archivedAt);
    if (currentStaff.role === "superadmin") return active;
    return active.filter((l) =>
      currentStaff.grantedLocationIds.includes(l.id)
    );
  }, [locations, currentStaff]);

  // Auto-select first accessible location once hydrated, if none chosen or stale.
  useEffect(() => {
    if (!hydrated) return;
    const validId =
      activeLocationId &&
      accessibleLocations.some((l) => l.id === activeLocationId);
    if (!validId) {
      const next = accessibleLocations[0]?.id ?? null;
      setActiveLocationIdState(next);
      if (next) window.localStorage.setItem(STORAGE_KEY_LOC, next);
      else window.localStorage.removeItem(STORAGE_KEY_LOC);
    }
  }, [hydrated, accessibleLocations, activeLocationId]);

  const setActiveLocationId = useCallback((id: string) => {
    setActiveLocationIdState(id);
    window.localStorage.setItem(STORAGE_KEY_LOC, id);
  }, []);

  const addLocation = useCallback((loc: Location) => {
    setLocations((prev) => [...prev, loc]);
  }, []);

  const updateLocation = useCallback((loc: Location) => {
    setLocations((prev) => prev.map((l) => (l.id === loc.id ? loc : l)));
  }, []);

  const archiveLocation = useCallback((id: string) => {
    setLocations((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, archivedAt: new Date().toISOString() } : l
      )
    );
  }, []);

  const restoreLocation = useCallback((id: string) => {
    setLocations((prev) =>
      prev.map((l) => (l.id === id ? { ...l, archivedAt: null } : l))
    );
  }, []);

  const switchStaff = useCallback((id: string) => {
    setCurrentStaffId(id);
    window.localStorage.setItem(STORAGE_KEY_STAFF, id);
  }, []);

  const updateStaffGrants = useCallback(
    (ids: string[]) => {
      setStaffList((prev) =>
        prev.map((s) =>
          s.id === currentStaffId ? { ...s, grantedLocationIds: ids } : s
        )
      );
    },
    [currentStaffId]
  );

  const activeLocation = useMemo(
    () =>
      accessibleLocations.find((l) => l.id === activeLocationId) ?? null,
    [accessibleLocations, activeLocationId]
  );

  const value: WorkspaceContextValue = {
    currentStaff,
    role: currentStaff.role,
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
    allStaff: staffList,
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
