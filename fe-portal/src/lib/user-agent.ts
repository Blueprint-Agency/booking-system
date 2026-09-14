/**
 * "Chrome on macOS" — a session's user agent as an admin reads it on a person's
 * sessions panel. A label, not a fingerprint: only enough to tell "my laptop"
 * from "a phone I don't own".
 *
 * Order matters in both lists. Edge and Opera carry "Chrome" in their string,
 * Chrome carries "Safari", and every iPhone string says "like Mac OS X".
 */
const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** Whether the session is on a phone or tablet, for its icon. */
export function isHandheld(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && /iPhone|iPad|Android|Mobile/.test(userAgent));
}

const first =(list: Array<[RegExp, string]>, ua: string) => list.find(([pattern]) => pattern.test(ua))?.[1];

export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = first(BROWSERS, userAgent);
  const system = first(SYSTEMS, userAgent);
  if (!browser) return system ? `Unknown browser on ${system}` : "Unknown browser";
  return system ? `${browser} on ${system}` : browser;
}
