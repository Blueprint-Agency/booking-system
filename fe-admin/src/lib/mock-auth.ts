"use client";

import { getCurrentAdmin, signInAdmin, signOutAdmin, useAdminState } from "./mock-state";
import type { AdminUser } from "@/types";

export function useCurrentAdmin(): AdminUser | null {
  const state = useAdminState();
  return getCurrentAdmin(state);
}

export { signInAdmin, signOutAdmin };
