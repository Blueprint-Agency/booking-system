/**
 * The handful of surfaces every member page is built from, so the browse
 * pages and the account area read as one app: a white card on the page
 * background, an ink pill for the main action, an outline pill beside it, and
 * one bottom-sheet dialog.
 */

export const CARD = "rounded-2xl bg-card border border-ink/5 shadow-soft";

/**
 * At least the height the app shell leaves a page: the 4rem top bar and,
 * below `md`, the 5rem (+ safe area) padding that clears the bottom tab bar.
 * For a page that is one panel — a sign-in card, a members-only notice, a
 * not-found — so the panel can sit centred in it rather than at the top.
 */
export const PAGE_FILL =
  "min-h-[calc(100dvh-9rem-env(safe-area-inset-bottom))] md:min-h-[calc(100dvh-4rem)]";

export const BTN_PRIMARY =
  "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const BTN_SECONDARY =
  "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-ink/10 px-5 text-sm font-semibold text-ink hover:border-ink/30 transition-colors disabled:opacity-50";

/** Booking a place — every "Book now" wears the studio's accent, wherever it sits. */
export const BOOK_FILL =
  "bg-accent text-inverse hover:bg-accent-deep transition-colors disabled:opacity-70 disabled:cursor-wait";
export const BTN_BOOK = `inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold ${BOOK_FILL}`;

/**
 * Cancelling something the member holds — a booking, a request, a place in
 * line. Always red, so it never passes for a way out of a dialog.
 */
export const BTN_CANCEL =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full border border-error/30 px-4 text-sm font-semibold text-error hover:bg-error/10 transition-colors disabled:opacity-60 disabled:cursor-wait";

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

// The wide overlay, for reading rather than confirming: on a phone a bottom
// sheet over the dimmed page, as tall as its content up to 90% of the screen,
// whose body scrolls between a fixed header and a fixed action bar; a centred
// wide panel from `sm` up. Same backdrop layer as the sheet, so a sheet opened
// from it stacks the same way.
export const OVERLAY_BACKDROP =
  "fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6";
export const OVERLAY_PANEL =
  "flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-card shadow-modal outline-none animate-fade-up sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-2xl";
export const OVERLAY_HEADER =
  "flex items-start gap-3 border-b border-ink/5 px-5 pb-4 pt-5 sm:px-6";
/**
 * The same overlay held in the middle of the screen at every width, rather
 * than rising from the bottom on a phone: for a look at something already
 * held (a day of My activity, a booked class), not a step towards booking.
 */
export const OVERLAY_BACKDROP_CENTRED =
  "fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm animate-fade-in sm:p-6";
export const OVERLAY_PANEL_CENTRED =
  "flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-2xl bg-card shadow-modal outline-none animate-fade-up sm:max-w-2xl";
/** The scrolling middle; `min-h-0` lets it shrink inside the flex column. */
export const OVERLAY_BODY = "min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6";
export const OVERLAY_ACTIONS =
  "flex flex-col-reverse gap-2 border-t border-ink/5 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:pb-4 [&>*]:flex-1 sm:[&>*]:flex-none";
