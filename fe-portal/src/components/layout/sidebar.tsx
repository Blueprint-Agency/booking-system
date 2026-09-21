"use client";
/**
 * The desktop sidebar frame both staff shells sit in: pinned to the viewport,
 * scrolling on its own, and collapsible to an icon rail.
 *
 * Pinned because the nav is how staff move between pages, and a long page (a
 * month of schedule, a customer's history) used to carry it off the top of the
 * screen. It is `sticky` to the viewport with its own scroll area, so the page
 * and the nav never move each other.
 *
 * The rail is a per-browser preference, kept in localStorage — it is about
 * this screen's width, not about the person, so it does not follow them to
 * another device.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "portal.sidebar.collapsed";
const CHANGE_EVENT = "portal:sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Another tab toggling it follows along.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the toggle still works for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

type RailTip = { label: string; top: number; left: number } | null;

const SidebarContext = createContext<{
  /** True inside the desktop rail. The mobile drawer never is — it has the room. */
  collapsed: boolean;
  showTip: (label: string, el: HTMLElement) => void;
  hideTip: () => void;
}>({ collapsed: false, showTip: () => {}, hideTip: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

/**
 * Props for anything in the rail that has only an icon to show: the label comes
 * back as a tooltip on hover and on keyboard focus. Spread onto the element.
 */
export function useRailTip(label: string) {
  const { collapsed, showTip, hideTip } = useSidebar();
  if (!collapsed) return {};
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(label, e.currentTarget),
    onMouseLeave: hideTip,
    onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(label, e.currentTarget),
    onBlur: hideTip,
  };
}

/** One nav row. In the rail it is the icon alone, with the label as its tooltip. */
export function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  onNavigate,
  onAccent,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
  /** Rendered on an accent-tinted surface — softer hover for contrast. */
  onAccent?: boolean;
}) {
  const { collapsed } = useSidebar();
  const tip = useRailTip(badge ? `${label} · ${badge}` : label);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      {...tip}
      className={cn(
        "group relative flex items-center rounded-lg text-sm transition-all duration-150",
        collapsed ? "h-9 justify-center" : "gap-3 px-3 py-2",
        active
          ? "bg-accent/10 font-medium text-accent"
          : onAccent
          ? "text-ink/75 hover:bg-accent/[0.08] hover:text-ink"
          : "text-ink/90 hover:bg-warm/70 hover:text-ink"
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
        />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-accent" : "text-muted group-hover:text-ink"
        )}
      />
      <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{label}</span>
      {badge !== undefined &&
        badge > 0 &&
        (collapsed ? (
          // The count doesn't fit an icon's width; a dot says "something waits".
          <span
            aria-label={`${badge} pending`}
            className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-warning ring-2 ring-card"
          />
        ) : (
          <span
            className={cn(
              "inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              active ? "bg-accent/15 text-accent" : "bg-warning/20 text-warning"
            )}
          >
            {badge}
          </span>
        ))}
    </Link>
  );
}

/**
 * A group's heading. In the rail a word will not fit, so it becomes a rule — the
 * grouping survives as spacing even when the names cannot.
 */
export function SidebarHeading({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();
  if (collapsed) return <div aria-hidden="true" className="mx-3 mb-2 border-t border-border" />;
  return (
    <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70">
      {children}
    </div>
  );
}

/** The studio mark at the top; its name hides in the rail. */
export function SidebarBrand({ href, children }: { href: string; children: ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2.5 py-4 text-sm font-semibold tracking-tight text-ink",
        // StudioMark renders the square then the name; the rail keeps the square.
        collapsed ? "justify-center px-0 [&>span+span]:sr-only" : "px-4"
      )}
    >
      {children}
    </Link>
  );
}

export function SidebarFrame({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  // Server and first client render agree on "expanded", then the stored choice
  // applies — no hydration mismatch.
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [tip, setTip] = useState<RailTip>(null);

  // The tooltip is drawn `fixed` from here rather than inside each link: the
  // scroll area clips anything that pokes out sideways.
  const showTip = useCallback((label: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  const toggle = () => {
    setTip(null);
    writeCollapsed(!collapsed);
  };

  return (
    <SidebarContext.Provider value={{ collapsed, showTip, hideTip }}>
      <nav
        aria-label="Main"
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 self-start flex-col border-r border-border bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className="shrink-0">{brand}</div>

        <div
          className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          onScroll={hideTip}
        >
          {children}
        </div>

        <div className="shrink-0 border-t border-border p-2.5">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            {...(collapsed
              ? {
                  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip("Expand sidebar", e.currentTarget),
                  onMouseLeave: hideTip,
                }
              : {})}
            className={cn(
              "flex h-9 w-full items-center gap-3 rounded-lg text-sm text-muted transition-colors hover:bg-warm/70 hover:text-ink",
              collapsed ? "justify-center" : "px-3"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-[18px] w-[18px] shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </nav>

      {collapsed && tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white shadow-soft animate-fade-in"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>
      )}
    </SidebarContext.Provider>
  );
}
