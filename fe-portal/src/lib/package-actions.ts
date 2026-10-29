import type { RefundProgress } from "./refund-copy";

export type PackageAction =
  | "balance"
  | "expiry"
  | "cross_location"
  | "home_location"
  | "bound_instructor"
  | "adjust"
  | "refund"
  | "remove";

export interface PackageMenuInput {
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
  cross_location_paid_sgd: string | null;
  refundable: boolean;
  refund_progress: RefundProgress;
  complimentary: boolean;
  /** Its Purchase was Refunded: the backend refuses every edit (`package_voided`). */
  voided: boolean;
}

function edits(p: PackageMenuInput): { action: PackageAction; label: string }[] {
  const out: { action: PackageAction; label: string }[] = [];
  if (p.kind === "credit_bundle" || p.kind === "trial") {
    out.push({ action: "balance", label: "Set credit balance" });
  }
  // Every kind expires, PT included — a PT package carries its own validity in
  // days like a Credit Bundle does. A blank date returns any kind to Dormant
  // (§8): every package starts there and Activates on its first booking.
  out.push({ action: "expiry", label: "Edit expiry" });
  // Only an Unlimited Plan has a Home Location to extend or move.
  if (p.kind === "unlimited") {
    out.push({
      action: "cross_location",
      label:
        p.cross_location_paid_sgd !== null
          ? "Edit Cross-Location Add-On"
          : "Add Cross-Location Add-On",
    });
    out.push({ action: "home_location", label: "Change home studio" });
  }
  // Only a PT Package has a Bound Instructor — one sold open is bound from here.
  if (p.kind === "pt") out.push({ action: "bound_instructor", label: "Change bound instructor" });
  if (p.kind !== "unlimited") out.push({ action: "adjust", label: "Manual adjustment" });
  return out;
}

/** What an admin can do to one package, in menu order. */
export function packageActions(p: PackageMenuInput): { action: PackageAction; label: string }[] {
  const out = p.voided ? [] : edits(p);
  // Always offered on a purchase that reached Stripe — attendance is a notice
  // inside the dialog, never a reason to hide the button (§14). Withheld only
  // while a Refund is already on its way and there is nothing left to ask
  // Stripe for; a part-issued one is offered again to return the rest.
  if (p.refundable && p.refund_progress !== "processing") {
    out.push({ action: "refund", label: "Refund purchase…" });
  }
  // A comp has no money behind it, so it is removed rather than refunded. The
  // backend is what knows whether a class it paid for has been held.
  if (p.complimentary) out.push({ action: "remove", label: "Remove free package…" });
  return out;
}
