"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Select } from "./select";

/** The one set of page sizes every list in the portal offers. 100 is the ceiling. */
export const PAGE_SIZES = [25, 50, 75, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export function isPageSize(n: number): boolean {
  return (PAGE_SIZES as readonly number[]).includes(n);
}

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Rows across every page. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** What the rows are, for the screen-reader labels — "customers", "payments". */
  noun?: string;
  /** A request is in flight: the arrows wait for it. */
  loading?: boolean;
  className?: string;
}

/**
 * The footer every list shares: "26–50 of 212", a per-page picker, and
 * previous/next. Hidden while everything fits on one page at the smallest
 * size — there is nothing to page through and nothing to choose.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = "rows",
  loading,
  className,
}: PaginationProps) {
  if (total <= PAGE_SIZES[0]) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} pages`}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-xs text-muted sm:px-5",
        className,
      )}
    >
      <span className="tabular-nums">
        <span className="text-ink">
          {first.toLocaleString()}–{last.toLocaleString()}
        </span>{" "}
        of {total.toLocaleString()}
      </span>
      <label className="flex items-center gap-1.5">
        <span>Show</span>
        <Select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-7 w-auto py-0 pl-2 pr-7 text-xs"
          aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} per page`}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </label>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[4.5rem] text-center tabular-nums">
          {page} / {pageCount}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          disabled={page >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

/**
 * Page a list that is already in memory. Returns the slice to render and the
 * props for `<Pagination>`. Goes back to page one whenever the list's length
 * or `resetKey` changes — a filter that leaves two pages must not strand the
 * reader on page seven.
 */
export function usePaged<T>(items: readonly T[], resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const total = items.length;

  // Reset while rendering rather than in an effect, so the stale page never
  // paints first.
  const [seen, setSeen] = useState({ total, resetKey });
  if (seen.total !== total || !Object.is(seen.resetKey, resetKey)) {
    setSeen({ total, resetKey });
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const visible = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );

  return {
    visible,
    pagination: {
      page: current,
      pageSize,
      total,
      onPageChange: setPage,
      onPageSizeChange: (n: number) => {
        setPageSize(n);
        setPage(1);
      },
    } satisfies Omit<PaginationProps, "noun">,
  };
}
