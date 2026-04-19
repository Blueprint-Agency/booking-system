export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // week starts Monday
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekdayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function monthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
