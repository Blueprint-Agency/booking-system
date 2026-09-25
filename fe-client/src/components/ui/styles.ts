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
