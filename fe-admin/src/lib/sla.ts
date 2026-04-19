export type SlaTier = "green" | "amber" | "red" | "overdue";

export function slaTier(deadlineIso: string, nowMs = Date.now()): SlaTier {
  const hoursLeft = (new Date(deadlineIso).getTime() - nowMs) / (1000 * 60 * 60);
  if (hoursLeft <= 0) return "overdue";
  if (hoursLeft < 2) return "red";
  if (hoursLeft <= 6) return "amber";
  return "green";
}

export function slaLabel(deadlineIso: string, nowMs = Date.now()): string {
  const ms = new Date(deadlineIso).getTime() - nowMs;
  if (ms <= 0) {
    const overdueH = Math.floor(-ms / (1000 * 60 * 60));
    return overdueH > 0 ? `Overdue ${overdueH}h` : "Overdue";
  }
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (h >= 1) return `${h}h ${m}m left`;
  return `${m}m left`;
}
