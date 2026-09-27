/**
 * The handful of surfaces every member page is built from, so the browse
 * pages and the account area read as one app: a white card on the page
 * background, an ink pill for the main action, an outline pill beside it, and
 * one bottom-sheet dialog.
 */

export const CARD = "rounded-2xl bg-card border border-ink/5 shadow-soft";

export const BTN_PRIMARY =
  "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const BTN_SECONDARY =
  "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-ink/10 px-5 text-sm font-semibold text-ink hover:border-ink/30 transition-colors disabled:opacity-50";

/** A short note inside a page or dialog — a rule, a heads-up. Not an error. */
export const NOTE = "rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink";

// A bottom sheet on phones — the actions land under the thumb, above the home
// indicator — and a centred dialog from `sm` up.
export const SHEET_BACKDROP =
  "fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4";
export const SHEET_PANEL =
  "w-full max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-card px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-modal outline-none animate-fade-up sm:max-w-md sm:rounded-2xl sm:p-6";
/** The grab bar at the top of a sheet; phones only. */
export const SHEET_HANDLE = "mx-auto mb-4 block h-1 w-10 rounded-full bg-ink/15 sm:hidden";
export const SHEET_TITLE = "text-lg font-bold text-ink";
export const SHEET_TEXT = "mt-1 text-sm text-muted leading-relaxed";
/** Stacked on a phone with the main action on top; side by side from `sm`. */
export const SHEET_ACTIONS = "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:gap-3 [&>*]:flex-1";

// The wide overlay, for reading rather than confirming: a full-height sheet on
// a phone, whose body scrolls between a fixed header and a fixed action bar,
// and a centred wide panel from `sm` up. Same backdrop layer as the sheet, so
// a sheet opened from it stacks the same way.
export const OVERLAY_BACKDROP =
  "fixed inset-0 z-[70] flex items-stretch justify-center bg-ink/40 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6";
export const OVERLAY_PANEL =
  "flex h-[100dvh] w-full flex-col overflow-hidden bg-card shadow-modal outline-none animate-fade-up sm:h-auto sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-2xl";
export const OVERLAY_HEADER =
  "flex items-start gap-3 border-b border-ink/5 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 sm:pt-5";
/** The scrolling middle; `min-h-0` lets it shrink inside the flex column. */
export const OVERLAY_BODY = "min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6";
export const OVERLAY_ACTIONS =
  "flex flex-col-reverse gap-2 border-t border-ink/5 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:pb-4 [&>*]:flex-1 sm:[&>*]:flex-none";
