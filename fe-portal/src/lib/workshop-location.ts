/**
 * The Location a new workshop starts on: the one staff are working in (the
 * header's workspace switcher), as a new class does, so a workshop made while
 * looking at one Location's timetable lands on that timetable. Only when that
 * Location is not one the form can offer does it fall back to the first.
 */
export function defaultWorkshopLocationId(
  locations: readonly { id: string }[],
  activeLocationId: string | null | undefined,
): string {
  if (activeLocationId && locations.some((l) => l.id === activeLocationId)) return activeLocationId;
  return locations[0]?.id ?? "";
}
