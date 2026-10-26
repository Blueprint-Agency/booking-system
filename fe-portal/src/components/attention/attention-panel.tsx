"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { formatRelative } from "@/lib/formatters";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import { locationFromHref, type AttentionGroup, type AttentionItem, type AttentionPanelData } from "@/lib/attention";
import { useAttention } from "./attention-provider";

type Tab = "needs_action" | "updates";

/** Rows each group shows before "See all". */
const ROWS_PER_GROUP = 5;

/**
 * The panel the bell opens: a popover under the bell from `lg`, a full-height
 * sheet below it. Portalled to the body because the top bar's backdrop blur
 * would otherwise become the containing block of a `fixed` child.
 *
 * It reads the full list each time it opens, and again when the bubble's count
 * moves while it is open, so what it shows is what the bubble counts.
 */
export function AttentionPanel({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const { api, accessibleLocations, setActiveLocationId } = useWorkspace();
  const { summary } = useAttention();
  const [tab, setTab] = useState<Tab>("needs_action");
  const [data, setData] = useState<AttentionPanelData | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const total = summary?.total ?? 0;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<AttentionPanelData>("/portal/attention", {
          limit_per_group: ROWS_PER_GROUP,
        });
        if (!cancelled) {
          setData(res);
          setFailed(false);
        }
      } catch (err) {
        if (!cancelled) setFailed(true);
        reportError(err, { scope: "attention-panel" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, total]);

  // Escape closes it; focus moves in on open and returns to the bell on close.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const back = returnFocusTo.current;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [returnFocusTo]);

  const groups = data?.needs_action.groups ?? [];
  const needsAction = summary?.needs_action ?? groups.reduce((n, g) => n + g.count, 0);
  const unread = summary?.unread_updates ?? 0;
  const showLocation = accessibleLocations.length > 1;

  /** Follow a link: switch the workspace first when it names another location, then close. */
  function follow(href: string | null) {
    const target = locationFromHref(href);
    if (target && accessibleLocations.some((l) => l.id === target)) setActiveLocationId(target);
    onClose();
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-overlay lg:bg-transparent"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-label="Notifications"
        tabIndex={-1}
        data-testid="attention-panel"
        className={cn(
          "absolute inset-0 flex flex-col bg-card shadow-modal outline-none",
          "lg:inset-auto lg:right-6 lg:top-[3.75rem] lg:max-h-[min(36rem,calc(100vh-5rem))] lg:w-[26rem] lg:rounded-xl lg:border lg:border-border",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div role="tablist" aria-label="Notifications" className="flex gap-1">
            <TabButton active={tab === "needs_action"} onClick={() => setTab("needs_action")}>
              Needs action ({needsAction})
            </TabButton>
            <TabButton active={tab === "updates"} onClick={() => setTab("updates")}>
              Updates{unread > 0 ? ` (${unread} new)` : ""}
            </TabButton>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="rounded-md p-2.5 text-muted hover:bg-paper hover:text-ink lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="tabpanel" className="flex-1 overflow-y-auto">
          {tab === "needs_action" ? (
            failed && !data ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Couldn&apos;t load notifications.</p>
            ) : !data ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing needs your attention</p>
            ) : (
              groups.map((g) => (
                <Group key={g.key} group={g} showLocation={showLocation} onFollow={follow} />
              ))
            )
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted">No updates yet</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-2 text-sm transition-colors",
        active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Group({
  group,
  showLocation,
  onFollow,
}: {
  group: AttentionGroup;
  showLocation: boolean;
  onFollow: (href: string | null) => void;
}) {
  const more = group.count - group.items.length;
  return (
    <section aria-label={group.label} className="border-b border-border last:border-b-0">
      <h3 className="flex items-center justify-between px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        <span>{group.label}</span>
        <span className="tabular-nums">{group.count}</span>
      </h3>
      <ul>
        {group.items.map((item) => (
          <Row key={item.id} item={item} showLocation={showLocation} onFollow={onFollow} />
        ))}
      </ul>
      {more > 0 && group.see_all_href && (
        <Link
          href={group.see_all_href}
          onClick={() => onFollow(group.see_all_href)}
          className="block px-4 pb-3 pt-1 text-xs font-medium text-accent hover:underline"
        >
          See all {group.count}
        </Link>
      )}
    </section>
  );
}

function Row({
  item,
  showLocation,
  onFollow,
}: {
  item: AttentionItem;
  showLocation: boolean;
  onFollow: (href: string | null) => void;
}) {
  const body = (
    <>
      <span className="block break-words text-sm font-semibold text-ink">{item.title}</span>
      <span className="mt-0.5 block break-words text-xs text-muted">{item.detail}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        {showLocation && item.location && (
          <span className="rounded-full bg-paper px-2 py-0.5 ring-1 ring-inset ring-border">
            {item.location.name}
          </span>
        )}
        {/* A row with no link is a standing fact about the studio's account, not an event with an age. */}
        {item.href && <span>{formatRelative(item.occurred_at)}</span>}
      </span>
    </>
  );
  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          onClick={() => onFollow(item.href)}
          className="block px-4 py-2.5 transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none"
        >
          {body}
        </Link>
      ) : (
        <div className="px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}
