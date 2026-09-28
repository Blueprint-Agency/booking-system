/**
 * The member's display preferences: light or dark, and how large the text is.
 *
 * **Saved to the account, applied from the device.** A signed-in member's choice
 * is kept on their record at the studio (`PATCH /me/display-prefs`), so it follows
 * them to every device they sign in on: the profile read after sign-in adopts it
 * (`lib/auth.ts`). But a preference the page needs before its first paint cannot
 * wait for a fetch, so this hostname's `localStorage` holds a copy, and that copy
 * is what the page paints from. Signed out, the copy is all there is.
 *
 * **Applied as attributes on `<html>`.** `data-theme` swaps the colour tokens
 * and `data-font-size` sets the root size that every `rem` in the app is
 * measured from (`globals.css`). The root layout runs `DISPLAY_PREFS_SCRIPT`
 * inline in `<head>`, so a reload paints in the member's choice rather than
 * flashing the default first.
 */

export type Theme = "light" | "dark";
export type FontSize = "small" | "medium" | "large";

export interface DisplayPrefs {
  theme: Theme;
  fontSize: FontSize;
}

export const THEMES: readonly Theme[] = ["light", "dark"];
export const FONT_SIZES: readonly FontSize[] = ["small", "medium", "large"];

/** What a member who has never chosen sees: the app as it has always looked. */
export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { theme: "light", fontSize: "small" };

export const DISPLAY_PREFS_KEY = "rt.client.display";

/**
 * A stored value, read defensively: it was written by an older build, or by
 * hand in devtools, as easily as by this one. Anything unrecognised falls back
 * field by field, so one bad value never costs the member the other.
 */
export function parseDisplayPrefs(raw: string | null): DisplayPrefs {
  if (!raw) return DEFAULT_DISPLAY_PREFS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
  if (!value || typeof value !== "object") return DEFAULT_DISPLAY_PREFS;
  const { theme, fontSize } = value as Record<string, unknown>;
  return {
    theme: THEMES.includes(theme as Theme) ? (theme as Theme) : DEFAULT_DISPLAY_PREFS.theme,
    fontSize: FONT_SIZES.includes(fontSize as FontSize)
      ? (fontSize as FontSize)
      : DEFAULT_DISPLAY_PREFS.fontSize,
  };
}

/** The account's copy, as `GET /me` gives it. A null field was never chosen. */
export interface AccountDisplayPrefs {
  theme: string | null;
  font_size: string | null;
}

/**
 * What the account has chosen, and only that: a field it has not (or one this
 * build does not know) leaves the device's own value standing.
 */
export function fromAccountDisplayPrefs(
  account: AccountDisplayPrefs | null | undefined,
): Partial<DisplayPrefs> {
  const out: Partial<DisplayPrefs> = {};
  if (THEMES.includes(account?.theme as Theme)) out.theme = account!.theme as Theme;
  if (FONT_SIZES.includes(account?.font_size as FontSize)) out.fontSize = account!.font_size as FontSize;
  return out;
}

/** The attributes `globals.css` keys on, for the element that carries them. */
export function applyDisplayPrefs(root: HTMLElement, prefs: DisplayPrefs): void {
  root.dataset.theme = prefs.theme;
  root.dataset.fontSize = prefs.fontSize;
}

/**
 * The same read and apply as above, as a string for the inline `<head>` script.
 * It runs before any bundle loads, so it cannot import; it only has to set the
 * attributes a valid stored value names, and `DisplayPrefsSync` re-applies the
 * parsed value once React is up.
 */
export const DISPLAY_PREFS_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  DISPLAY_PREFS_KEY,
)})||"{}"),d=document.documentElement;if(${JSON.stringify(THEMES)}.indexOf(p.theme)>=0)d.dataset.theme=p.theme;if(${JSON.stringify(
  FONT_SIZES,
)}.indexOf(p.fontSize)>=0)d.dataset.fontSize=p.fontSize}catch(e){}})()`;
