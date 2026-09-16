"use client";

import { useUser, useClerk } from "@clerk/nextjs";

export type AppUser = {
  firstName: string;
  lastName: string;
  email: string;
  imageUrl?: string;
};

export function useAppUser(): { user: AppUser | null; isLoaded: boolean } {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return { user: null, isLoaded: false };
  if (!user) return { user: null, isLoaded: true };
  return {
    user: {
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      email: user.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user.imageUrl,
    },
    isLoaded: true,
  };
}

export { useClerk };
