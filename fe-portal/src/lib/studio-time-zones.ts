/**
 * The zones the super portal's New studio form offers, and the one it starts on.
 *
 * A studio's zone is fixed when it is created, so the form takes it from the
 * runtime's own list of IANA zones (a select, not free text: it cannot be
 * misspelt) and starts on the Platform administrator's own browser zone. No
 * zone is presented as the platform's default; Singapore is just one entry.
 */

/** The browser's own zone, or "" when it cannot name one. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * The zones to list and the one to start on.
 *
 * `supported` is the runtime's list (`Intl.supportedValuesOf("timeZone")`), a
 * parameter only so the rule can be tried against a short list. That list
 * leaves out `UTC`, which a browser may well report, so the browser's zone is
 * added when it is missing: the form can always start on it.
 */
export function studioZoneChoices(
  browserZone: string,
  supported: readonly string[] = Intl.supportedValuesOf("timeZone"),
): { initial: string; zones: string[] } {
  const zones = [...new Set(supported)];
  if (browserZone && !zones.includes(browserZone)) zones.push(browserZone);
  zones.sort();
  return { initial: browserZone, zones };
}
