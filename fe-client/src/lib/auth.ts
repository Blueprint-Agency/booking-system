"use client";

import { useEffect, useSyncExternalStore } from "react";
import { makeApi } from "@/lib/api";
import { getMemberToken, readMemberToken, useMemberSession } from "@/lib/member-auth";

const api = makeApi(getMemberToken);

export type AppUser = {
  firstName: string;
  lastName: string;
  email: string;
};

/**
 * The signed-in member as the top bar and the account pages show them.
 *
 * The name is this studio's `clients` row (`GET /me`), not the auth user: a
 * member's name lives on their record at each studio and is edited there, on
 * the profile page. There is no other source of truth for it any more.
 *
 * One read per session, shared by every caller; `refreshAppUser()` re-reads it
 * after the profile page saves, so the top bar follows the edit.
 */
type Profile = { name: string; email: string };

let profile: Profile | null = null;
/** Whose profile `profile` is. */
let profileFor: string | null = null;
/** The last user a read was asked for — once per user, so a failing read is not retried every render. */
let requestedFor: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function loadProfile(userId: string): Promise<void> {
  const token = readMemberToken();
  if (!token) return;
  try {
    const res = await api.get<Profile>("/me");
    profile = { name: res.name, email: res.email };
    profileFor = userId;
    emit();
  } catch {
    // The top bar falls back to the session's email; nothing to surface.
  }
}

function ensureProfile(userId: string): void {
  if (requestedFor === userId) return;
  requestedFor = userId;
  void loadProfile(userId);
}

/** Re-read the member's profile, after an edit. */
export async function refreshAppUser(): Promise<void> {
  if (requestedFor) await loadProfile(requestedFor);
}

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() };
}

export function useAppUser(): { user: AppUser | null; isLoaded: boolean; isSignedIn: boolean } {
  const { isLoaded, session } = useMemberSession();
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => profile,
    () => null,
  );

  const userId = session?.userId ?? null;
  useEffect(() => {
    if (userId) ensureProfile(userId);
  }, [userId]);

  if (!isLoaded) return { user: null, isLoaded: false, isSignedIn: false };
  if (!session) return { user: null, isLoaded: true, isSignedIn: false };
  const named = profileFor === session.userId && current ? splitName(current.name) : null;
  return {
    user: {
      firstName: named?.firstName ?? "",
      lastName: named?.lastName ?? "",
      email: session.email,
    },
    isLoaded: true,
    isSignedIn: true,
  };
}
