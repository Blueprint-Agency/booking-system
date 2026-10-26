"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { formatRelative } from "@/lib/formatters";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import {
  appendOlder,
  locationFromHref,
  markAllReadLocally,
  markUpdateReadLocally,
  unreadCount,
  updatesTabLabel,
  type AttentionGroup,
  type AttentionItem,
  type AttentionPanelData,
  type AttentionUpdate,
} from "@/lib/attention";
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
  const { summary, refresh } = useAttention();
  const [tab, setTab] = useState<Tab>("needs_action");
  const [data, setData] = useState<AttentionPanelData | null>(null);
  const [older, setOlder] = useState<AttentionUpdate[]>([]);
  // undefined: no older page loaded yet, so the first page's cursor leads.
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
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
  // The first page comes with the panel; "Show older" appends pages after it.
  const updates = appendOlder(data?.updates.items ?? [], older);
  const cursor = olderCursor !== undefined ? olderCursor : (data?.updates.next_cursor ?? null);

  async function showOlder() {
    if (!api || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.get<AttentionPanelData>("/portal/attention", {
        limit_per_group: 1,
        updates_before: cursor,
      });
      setOlder((prev) => appendOlder(prev, res.updates.items));
      setOlderCursor(res.updates.next_cursor);
    } catch (err) {
      reportError(err, { scope: "attention-updates-older" });
    } finally {
      setLoadingOlder(false);
    }
  }

  /** Opening an update marks it read (the row is bold until then), then follows its link. */
  function openUpdate(u: AttentionUpdate) {
    if (u.read_at === null) {
      const at = new Date().toISOString();
      setData((d) => (d ? { ...d, updates: { ...d.updates, items: markUpdateReadLocally(d.updates.items, u.id, at) } } : d));
      setOlder((prev) => markUpdateReadLocally(prev, u.id, at));
      void (async () => {
        try {
          await api?.post(`/portal/attention/updates/${u.id}/read`);
        } catch (err) {
          reportError(err, { scope: "attention-update-read" });
        } finally {
          refresh();
        }
      })();
    }
    follow(u.href);
  }

  async function markAllRead() {
    if (!api) return;
    const at = new Date().toISOString();
    setData((d) => (d ? { ...d, updates: { ...d.updates, items: markAllReadLocally(d.updates.items, at) } } : d));
    setOlder((prev) => markAllReadLocally(prev, at));
    try {
      await api.post("/portal/attention/updates/read-all");
    } catch (err) {
      reportError(err, { scope: "attention-update-read-all" });
    } finally {
      refresh();
    }
  }
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
              {updatesTabLabel(unread)}
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
          ) : !data ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Loading…</p>
          ) : updates.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No updates yet</p>
          ) : (
            <>
              {unreadCount(updates) > 0 && (
                <div className="flex justify-end border-b border-border px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="rounded-md px-1 py-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    Mark all as read
                  </button>
                </div>
              )}
              <ul>
                {updates.map((u) => (
                  <UpdateRow key={u.id} update={u} onOpen={openUpdate} />
                ))}
              </ul>
              {cursor && (
                <button
                  type="button"
                  disabled={loadingOlder}
                  onClick={() => void showOlder()}
                  className="block w-full px-4 py-3 text-center text-xs font-medium text-accent hover:underline disabled:opacity-60"
                >
                  {loadingOlder ? "Loading…" : "Show older"}
                </button>
              )}
            </>
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

function UpdateRow({
  update,
  onOpen,
}: {
  update: AttentionUpdate;
  onOpen: (update: AttentionUpdate) => void;
}) {
  const unread = update.read_at === null;
  const body = (
    <span className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")}
      />
      <span className="min-w-0">
        <span className={cn("block break-words text-sm text-ink", unread ? "font-semibold" : "font-normal")}>
          {update.title}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        {update.detail && <span className="mt-0.5 block break-words text-xs text-muted">{update.detail}</span>}
        <span className="mt-1 block text-[11px] text-muted">{formatRelative(update.created_at)}</span>
      </span>
    </span>
  );
  return (
    <li>
      {update.href ? (
        <Link
          href={update.href}
          onClick={() => onOpen(update)}
          className="block px-4 py-2.5 transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none"
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(update)}
          className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-none"
        >
          {body}
        </button>
      )}
    </li>
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
        <span>{formatRelative(item.occurred_at)}</span>
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
