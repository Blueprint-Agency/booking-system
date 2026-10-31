/**
 * The zones the super portal's New studio form offers, and the one it starts on.
 *
 * A studio's zone is fixed when it is created, so the form takes it from the
 * runtime's own list of IANA zones (a select, not free text: it cannot be
 * misspelt) and starts on the Platform administrator's own browser zone. No
 * zone is presented as the platform's default; Singapore is just one entry.
 */

/**
 * Link names that V8's list (`Intl.supportedValuesOf("timeZone")`) and some
 * browsers' own zone still use, mapped to the name the tz database gives the
 * same zone today. Debian's Postgres, which the backend's CI and compose stack
 * run, does not know the old spellings, so the form only ever offers and posts
 * the current one. The backend keeps the same table
 * (`be/src/services/tenants/time-zone.ts`): the two share no code.
 */
export const CURRENT_ZONE_NAME: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** The same zone under the name the tz database gives it today. */
export function currentZoneName(name: string): string {
  return CURRENT_ZONE_NAME[name] ?? name;
}

/** The browser's own zone, under its current name, or "" when it cannot name one. */
export function browserTimeZone(): string {
  try {
    return currentZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  } catch {
    return "";
  }
}

/**
 * The runtime's zone list, or null where it has none: `Intl.supportedValuesOf`
 * is missing before Safari 15.4 and Chrome 99, and calling it there throws.
 * Read once, at module level, not on every render.
 */
const RUNTIME_ZONES: readonly string[] | null = (() => {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : null;
  } catch {
    return null;
  }
})();

/** The list as the form shows it, built once: current names, `UTC`, in order. */
const LISTED_ZONES: readonly string[] = zonesOf(RUNTIME_ZONES);

function zonesOf(supported: readonly string[] | null): string[] {
  if (!supported || supported.length === 0) return [];
  // The runtime's list leaves out `UTC`, which the backend accepts.
  return [...new Set([...supported.map(currentZoneName), "UTC"])].sort();
}

export type StudioZoneChoices = {
  /** The zone the form starts on: the browser's own, or "" when it names none. */
  initial: string;
  /** Every zone to offer, once each and in order. */
  zones: string[];
  /** True where there is no list to pick from, so the zone is typed and the API checks it. */
  freeText: boolean;
};

/**
 * The zones to list and the one to start on.
 *
 * `supported` is the runtime's list, a parameter only so the rule can be tried
 * against a short one; null (or empty) means the runtime has none, and the form
 * falls back to a typed field. That list leaves out `UTC`, which a browser may
 * well report, and carries legacy spellings, so both are normalised, and the
 * browser's zone is added when it is missing: the form can always start on it.
 */
export function studioZoneChoices(
  browserZone: string,
  supported: readonly string[] | null = RUNTIME_ZONES,
): StudioZoneChoices {
  const initial = currentZoneName(browserZone);
  const listed = supported === RUNTIME_ZONES ? [...LISTED_ZONES] : zonesOf(supported);
  if (listed.length === 0) return { initial, zones: [], freeText: true };
  if (initial && !listed.includes(initial)) listed.push(initial);
  return { initial, zones: listed.sort(), freeText: false };
}

/**
 * What the form says when the API refuses the zone, or null for any other code.
 *
 * The zone is pre-filled from the browser, so a refusal can be of a zone the
 * operator never typed or chose between alternatives for: it must not tell them
 * to pick from a list they already picked from.
 */
export function zoneRefusalMessage(code: string | undefined, zone: string, freeText: boolean): string | null {
  if (code === "timezone_required") {
    return freeText ? "Enter the studio’s time zone, like Australia/Sydney." : "Choose the studio’s time zone.";
  }
  if (code === "timezone_invalid") {
    return freeText
      ? `“${zone}” is not a time zone the server knows. Check the spelling; it looks like Australia/Sydney.`
      : `The server did not accept “${zone}” as a time zone. Try the nearest other zone in the same region, and tell the platform team.`;
  }
  return null;
}
