"use client";

import { AppTopBar } from "./app-top-bar";
import { SideRail } from "./side-rail";
import { BottomTabBar } from "./bottom-tab-bar";
import { SiteFooter } from "./site-footer";

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
        {/* The footer below the page, not inside its <main>, so it is the
            page's own contentinfo; both clear the phone's tab bar together. */}
        <div className="flex flex-1 min-w-0 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
          <main className="flex-1 min-w-0">{children}</main>
          <SiteFooter />
        </div>
      </div>
      <BottomTabBar />
    </>
  );
}
