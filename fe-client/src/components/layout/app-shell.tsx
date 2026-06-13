"use client";

import { AppTopBar } from "./app-top-bar";
import { SideRail } from "./side-rail";
import { BottomTabBar } from "./bottom-tab-bar";

export function AppShell({
  children,
  impersonating = false,
}: {
  children: React.ReactNode;
  impersonating?: boolean;
}) {
  return (
    <>
      <AppTopBar impersonating={impersonating} />
      <div className="flex flex-1">
        <SideRail />
        <main className="flex-1 min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      </div>
      <BottomTabBar />
    </>
  );
}
