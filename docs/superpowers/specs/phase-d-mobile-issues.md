# Phase D Mobile Responsive Audit

**Date:** 2026-04-19
**Viewport:** 375×812

## Findings

All 24 routes audited (Phase B + C + D). No horizontal body overflow detected on any route (`document.documentElement.scrollWidth - window.innerWidth <= 0`).

### Fixes applied

- **`/account/history`** — Table's intrinsic width (~569px) overflowed its card on mobile, clipped by the card's `overflow-hidden`. Wrapped table in `overflow-x-auto` div with `min-w-[560px]` so the table scrolls horizontally inside the card on narrow viewports.

### Notes

- `AccountShell` sidebar correctly collapses to single-column (grid `lg:grid-cols-[260px_1fr]`) at <1024px.
- `AuthSplitShell` hides the photo panel on mobile via `hidden lg:block`.
- Checkout two-column layout stacks vertically via `grid-cols-1 lg:grid-cols-[1fr_380px]`.
- Workshop detail sticky purchase card becomes non-sticky on mobile (sticky only at `lg:`).
