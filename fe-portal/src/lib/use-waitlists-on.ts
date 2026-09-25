"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import type { StaffRole } from "@/lib/class-seats";
import { fetchWaitlistsOn } from "@/lib/class-waitlist";

/**
 * The studio's waitlist switch, for a scheduling form's capacity fields.
 * Undefined until read, and left undefined if the read fails: the field then
 * shows its plain label rather than a claim the form can't back.
 */
export function useWaitlistsOn(role: StaffRole): boolean | undefined {
  const { api } = useWorkspace();
  const [on, setOn] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!api) return;
    let live = true;
    fetchWaitlistsOn(api, role).then(
      (value) => live && setOn(value),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, role]);
  return on;
}
