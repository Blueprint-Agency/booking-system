"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  entitySlugInPath,
  packageEntities as entitiesWithPackages,
  packagesHref,
  resolveEntity,
  showEntityDropdown,
} from "@/lib/entities";
import { usePublicEntities } from "@/lib/public-entities";
import { APP_NAV_ITEMS } from "./app-nav-items";

const ITEM = "flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors";

export function SideRail() {
  const pathname = usePathname();
  const { data: entities } = usePublicEntities();
  // The Packages item opens into one link per Entity, but only for a studio
  // with two or more Entities that have packages; otherwise it is a plain link.
  const packageEntities = entities && showEntityDropdown(entities) ? entitiesWithPackages(entities) : null;
  return (
    <aside className="hidden md:flex md:flex-col md:w-56 shrink-0 border-r border-border bg-paper">
      <nav className="flex flex-col gap-1 p-3 sticky top-16">
        {APP_NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          const link = (
            <Link
              key={href}
              href={href}
              aria-current={active && !(href === "/packages" && packageEntities) ? "page" : undefined}
              className={cn(ITEM, active ? "text-accent-deep bg-accent/10" : "text-muted hover:text-ink hover:bg-warm")}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </Link>
          );
          if (href !== "/packages" || !packageEntities) return link;

          const current = active ? resolveEntity(entitySlugInPath(pathname), packageEntities) : undefined;
          return (
            // Open on hover and on keyboard focus, and kept open while the member is on a Packages page.
            <div key={href} className="group flex flex-col gap-1">
              {link}
              <ul
                aria-label="Packages by Entity"
                className={cn(
                  "ml-5 flex-col gap-1 border-l border-border pl-2",
                  active ? "flex" : "hidden group-hover:flex group-focus-within:flex",
                )}
              >
                {packageEntities.map((e) => {
                  const here = current?.slug === e.slug;
                  return (
                    <li key={e.id}>
                      <Link
                        href={packagesHref(e)}
                        aria-current={here ? "page" : undefined}
                        className={cn(
                          "block px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                          here ? "text-accent-deep bg-accent/10" : "text-muted hover:text-ink hover:bg-warm",
                        )}
                      >
                        {e.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
