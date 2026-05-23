"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { inboxItems } from "@/data";
import { formatRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/types";

function humanizeType(type: string): string {
  const s = type.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describe(item: InboxItem): string {
  const p = item.payload as Record<string, unknown>;
  const name = typeof p.clientName === "string" ? p.clientName : "";
  const label = typeof p.sessionLabel === "string" ? p.sessionLabel : "";
  return [name, label].filter(Boolean).join(" · ") || "—";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // Local read overrides layered on the mock data (the module array is effectively read-only).
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(inboxItems.filter((i) => i.readAt).map((i) => i.id)),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [...inboxItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = items.filter((i) => !readIds.has(i.id)).length;

  const markAllRead = () => setReadIds(new Set(items.map((i) => i.id)));
  const markRead = (id: string) => setReadIds((prev) => new Set(prev).add(id));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink",
          open && "bg-paper text-ink",
        )}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white ring-2 ring-card">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-modal">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-deep"
              >
                <Check className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted">
                You&apos;re all caught up.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.slice(0, 12).map((item) => {
                  const isUnread = !readIds.has(item.id);
                  return (
                    <li key={item.id}>
                      <Link
                        href="/admin/inbox"
                        onClick={() => {
                          markRead(item.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex gap-3 px-4 py-3 transition-colors hover:bg-paper",
                          isUnread && "bg-accent/[0.04]",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            isUnread ? "bg-accent" : "bg-transparent",
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">
                              {humanizeType(item.type)}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted">
                              {formatRelative(item.createdAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {describe(item)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border">
            <Link
              href="/admin/inbox"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-center text-xs font-medium text-accent transition-colors hover:bg-paper"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
