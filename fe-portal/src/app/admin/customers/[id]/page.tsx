"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Mail,
  Pencil,
  Phone,
  MoreVertical,
  ShieldOff,
  ShieldCheck,
  Loader2,
  RotateCcw,
  AlertTriangle,
  Download,
  Trash2,
  Gift,
  ChevronDown,
  ChevronRight,
  FileCheck,
  FileWarning,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  Pagination,
  usePaged,
} from "@/components/ui";
import { PackageExpiryDialog } from "@/components/clients/package-expiry-dialog";
import { CrossLocationDialog } from "@/components/clients/cross-location-dialog";
import { HomeLocationDialog } from "@/components/clients/home-location-dialog";
import { BoundInstructorDialog } from "@/components/clients/bound-instructor-dialog";
import { PackageSetBalanceDialog } from "@/components/clients/package-set-balance-dialog";
import { RefundDialog } from "@/components/clients/refund-dialog";
import { REFUND_REFUSALS } from "@/lib/refund-refusals";
import { GivePackageDialog, type GivePackagePayload } from "@/components/clients/give-package-dialog";
import { RemovePackageDialog } from "@/components/clients/remove-package-dialog";
import { ChangeEmailDialog } from "@/components/clients/change-email-dialog";
import { EditProfileDialog } from "@/components/clients/edit-profile-dialog";
import { SendSetPasswordButton } from "@/components/access/send-set-password-button";
import { SessionsPanel } from "@/components/access/sessions-panel";
import { runsStudio } from "@/lib/staff-role";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import {
  REFUND_PROCESSING_LABEL,
  refundFailureMessage,
  refundProgressTag,
  refundReplyToast,
  type RefundKind,
  type RefundProgress,
  type RefundReply,
} from "@/lib/refund-copy";
import { downloadFile } from "@/lib/download";
import { getPortalToken } from "@/lib/portal-auth";
import { formatDate, formatRelative } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ClientPackage } from "@/types";

type PackageKind = "credit_bundle" | "unlimited" | "trial" | "pt";

interface ApiPackage {
  id: string;
  kind: PackageKind;
  source_package_id: string | null;
  package_name: string;
  credits_or_sessions_remaining: number | null;
  credits_or_sessions_total: number | null;
  expires_at: string | null;
  purchased_at: string;
  amount_paid_sgd: string;
  /** Catalogue price frozen at purchase. The money off is derived from these two. */
  list_price_sgd: string;
  /** Backend-derived — never re-tested here as "unlimited and no end date". */
  dormant: boolean;
  unlimited_location: { id: string; name: string } | null;
  duration_months: number | null;
  /** What the member paid for the Cross-Location Add-On; null means Home Location only. */
  cross_location_paid_sgd: string | null;
  /** The Promo Code the member typed at purchase; null if none. */
  promo_code: string | null;
  /**
   * The one instructor this PT Package's sessions go to; null means open to
   * anyone. Still named after they are archived — the package stays bound until
   * an admin rebinds it.
   */
  bound_instructor: { id: string; name: string } | null;
  /** There is money at the payment provider to give back (§14). */
  refundable: boolean;
  /**
   * Given by an admin at no charge (#176). What "Remove" is offered on, and why
   * S$0 against a real list price is not a discount somebody granted.
   */
  complimentary: boolean;
  /**
   * Backend-composed — "3 classes used (attended or no-show) since 12 Jun 2026",
   * or null when the purchase is Untouched. A notice, never a gate: the refund
   * is still allowed.
   */
  refund_notice: string | null;
  /** How many refunds the Refund will put on the statement (#93). */
  refund_payment_count: number;
  /** Whether a Refund is already on its way — the action is withheld while one is (#275). */
  refund_progress: RefundProgress;
  /** What the Refund gives back — the whole Purchase, Add-On included when bought with it. */
  refund_amount_sgd: string;
  /** Add-On bought with the plan (true), separately (false), or none (null). */
  refund_includes_add_on: boolean | null;
  /** Bookings still ahead on this package — the Refund cancels every one. */
  refund_upcoming_booking_count: number;
  /** The Promo Code the Refund frees, or null. */
  refund_promo_code: string | null;
  /** Backend-derived; decides which list the package is in and its badge. */
  standing: PackageStanding;
  /**
   * An online payment stands behind it. False on a comp, a $0 trial and a
   * package imported from another system — none has a discount to derive.
   */
  paid_online: boolean;
}

type PackageStanding = "running" | "dormant" | "expired" | "used_up" | "ended";

/** Running needs no badge — it is the normal state of a current package. */
const STANDING_BADGE: Partial<
  Record<PackageStanding, { label: string; tone: "neutral" | "warning" | "error" }>
> = {
  dormant: { label: "Not started", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  used_up: { label: "Used up", tone: "neutral" },
  ended: { label: "Ended", tone: "error" },
};

interface ApiBooking {
  booking_id: string;
  kind: "class" | "workshop" | "pt";
  /** Class type or workshop name; null for a private session. */
  title: string | null;
  tier_name: string | null;
  session_type: "1on1" | "2on1" | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  instructor: string | null;
  state: "confirmed" | "cancelled" | "no_show";
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  refund_outcome: "credit_returned" | "session_returned" | "stripe_refunded" | "forfeited" | "n_a";
  credits_used: number | null;
  package_name: string | null;
  code: string;
  booked_at: string;
  cancelled_at: string | null;
  /**
   * Backend-composed — what an admin cancel does with the credit ("1 credit goes
   * back to …"). Null when the booking cannot be cancelled from here.
   */
  cancel_notice: string | null;
}

interface ApiAttendance {
  attended: number;
  no_shows: number;
  late_cancels: number;
  last_attended_at: string | null;
}

interface ApiPayment {
  id: string;
  item_name: string;
  kind: string;
  amount_sgd: string;
  status: "pending" | "succeeded" | "refunded" | "failed";
  purchase_status: "open" | "paid" | "refunded" | "abandoned";
  receipt_url: string | null;
  refunded_at: string | null;
  /** A Refund has been issued and Stripe has not yet confirmed it (#275). */
  refund_processing: boolean;
  created_at: string;
}

interface ApiWorkshopPurchase {
  booking_id: string;
  workshop_name: string;
  tier_name: string | null;
  amount_paid_sgd: string;
  list_price_sgd: string;
  purchased_at: string;
  /** Its Workshop was cancelled and the money has not come back yet (#272). */
  cancelled: boolean;
  refundable: boolean;
  refund_notice: string | null;
  refund_payment_count: number;
  refund_progress: RefundProgress;
  refund_amount_sgd: string;
  refund_promo_code: string | null;
}

/**
 * A purchase the member started paying for and has not finished (#93).
 *
 * Money the studio is holding against **nothing granted**: no plan, no place,
 * no credits. It is listed apart from the packages for exactly that reason —
 * a row among them would read as an entitlement, and the front desk would let
 * somebody into a class they have not finished paying for.
 */
interface ApiOpenPurchase {
  id: string;
  kind: string;
  item_name: string;
  total_sgd: string;
  paid_sgd: string;
  outstanding_sgd: string;
  part_paid_at: string | null;
  created_at: string;
  grants_nothing: boolean;
  /** How many returns one press of Refund will put on the statement (#95). */
  refund_payment_count: number;
  refund_progress: RefundProgress;
}

/** What one press of a Refund button answers (#275). */
interface ApiRefundReply extends RefundReply {
  /** An unfinished purchase's reply names what went back — "2 payments returned, totalling S$120.00". */
  returned_line?: string;
}

/** The badge a purchase wears while its Refund is on its way, or none. */
function refundProgressBadge(progress: RefundProgress): ReactNode {
  const tag = refundProgressTag(progress);
  return tag && <Badge tone={tag.tone}>{tag.label}</Badge>;
}

interface ApiAdjustment {
  id: string;
  client_package_id: string;
  delta: number;
  reason: string;
  acted_by_staff_id: string;
  created_at: string;
}

interface ApiProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "suspended";
  joined_at: string;
  suspended_at: string | null;
  deleted_at: string | null;
  deleted_by_staff_id: string | null;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  /** yyyy-mm-dd, or null when never given. */
  dob: string | null;
  waiver_signed_at: string | null;
  referred_by: { id: string; name: string } | null;
  /** Current: running, or waiting for a first booking. */
  packages: ApiPackage[];
  /** Expired, used up, refunded — newest first. */
  past_packages: ApiPackage[];
  upcoming_bookings: ApiBooking[];
  /** The most recent 50; `attendance` counts every booking ever. */
  past_bookings: ApiBooking[];
  attendance: ApiAttendance;
  payments: ApiPayment[];
  workshop_purchases: ApiWorkshopPurchase[];
  adjustments: ApiAdjustment[];
  open_purchases: ApiOpenPurchase[];
}

/**
 * The backend's refusals for this page, in words an admin can act on. Every one
 * of them names a rule they can satisfy — which package, which member, which
 * address — and none of them re-derives the rule here: the backend decides, and
 * this only says so. Anything not listed falls back to the status code.
 */
const REFUSALS: Record<string, string> = {
  family_already_activated:
    "Another package of this type is already running. Only one class package and one PT package can run at a time — return the running one to Dormant first, or wait for it to end.",
  package_touched:
    "A class this package paid for has already been held, so it cannot be removed. Adjust the balance or the expiry instead.",
  package_has_live_bookings:
    "This package still has a booking on it. Cancel that booking, then remove the package.",
  not_complimentary:
    "Only a package given for free can be removed. A purchase is refunded instead.",
  trial_already_used:
    "This member has already had a trial, and the one-trial rule holds for free ones too.",
  unlimited_requires_location: "An unlimited plan needs a home studio.",
  pt_bound_requires_instructor:
    "This PT package's sessions go to one instructor — pick who.",
  email_in_use: "Another member of this studio already uses that email.",
  email_unchanged: "That is already this member's email.",
  client_blocked: "This member is blocked. Unblock them first.",
  name_required: "A name is required.",
  phone_required: "A phone number is required.",
  booking_attended:
    "They have already been checked in to this class. Untick them on the roster first if that was a mistake.",
  not_cancellable: "This booking is no longer booked — it may already have been cancelled.",
  ...REFUND_REFUSALS,
};

/** List Price minus what was paid, as "S$12.34", or null when there's no discount. */
function discountOff(listPriceSgd: string, amountPaidSgd: string): string | null {
  const off = Number(listPriceSgd) - Number(amountPaidSgd);
  return off > 0 ? `S$${off.toFixed(2)}` : null;
}

/** Build the ClientPackage shape the shared edit dialogs expect. */
function toClientPackage(clientId: string, p: ApiPackage): ClientPackage {
  return {
    id: p.id,
    clientId,
    kind: p.kind,
    sourcePackageId: p.source_package_id ?? "",
    packageName: p.package_name,
    creditsOrSessionsRemaining: p.credits_or_sessions_remaining,
    creditsOrSessionsTotal: p.credits_or_sessions_total,
    expiresAt: p.expires_at,
    purchasedAt: p.purchased_at,
    amountPaidSgd: Number(p.amount_paid_sgd),
  };
}

type PackageAction =
  | "balance"
  | "expiry"
  | "cross_location"
  | "home_location"
  | "bound_instructor"
  | "adjust"
  | "refund"
  | "remove";

/** What an admin can do to one package, in menu order. */
function packageActions(p: ApiPackage): { action: PackageAction; label: string }[] {
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
  // Always offered on a purchase that reached Stripe — attendance is a notice
  // inside the dialog, never a reason to hide the button (§14). Withheld only
  // while a Refund is already on its way and there is nothing left to ask
  // Stripe for (#275); a part-issued one is offered again to return the rest.
  if (p.refundable && p.refund_progress !== "processing") {
    out.push({ action: "refund", label: "Refund purchase…" });
  }
  // A comp has no money behind it, so it is removed rather than refunded. The
  // backend is what knows whether a class it paid for has been held.
  if (p.complimentary) out.push({ action: "remove", label: "Remove free package…" });
  return out;
}

export default function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { api, role } = useWorkspace();
  const router = useRouter();
  const canEdit = runsStudio(role);

  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adjustFor, setAdjustFor] = useState<ApiPackage | null>(null);
  const [balanceFor, setBalanceFor] = useState<ApiPackage | null>(null);
  const [expiryFor, setExpiryFor] = useState<ApiPackage | null>(null);
  const [crossLocationFor, setCrossLocationFor] = useState<ApiPackage | null>(null);
  const [homeLocationFor, setHomeLocationFor] = useState<ApiPackage | null>(null);
  const [boundInstructorFor, setBoundInstructorFor] = useState<ApiPackage | null>(null);
  const [refundFor, setRefundFor] = useState<ApiPackage | null>(null);
  const [giveOpen, setGiveOpen] = useState(false);
  const [removeFor, setRemoveFor] = useState<ApiPackage | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workshopRefundFor, setWorkshopRefundFor] = useState<ApiWorkshopPurchase | null>(null);
  const [cancelBookingFor, setCancelBookingFor] = useState<ApiBooking | null>(null);
  const [openPurchaseRefundFor, setOpenPurchaseRefundFor] = useState<ApiOpenPurchase | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showPastPackages, setShowPastPackages] = useState(false);

  // Everything the studio holds about this member, for an access request (#143).
  // Logged as a staff act on the member.
  const downloadData = async () => {
    setExporting(true);
    try {
      await downloadFile(getPortalToken, `/portal/admin/clients/${id}/export`, {
        fallbackName: `member-${id.slice(0, 8)}.zip`,
        failure: "The member's data could not be downloaded.",
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The member's data could not be downloaded.");
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiProfile>(`/portal/admin/clients/${id}`);
      setProfile(res);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "Customer not found."
          : err instanceof ApiError
            ? `HTTP ${err.status}`
            : "Network error",
      );
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runEdit(action: () => Promise<unknown>, successMsg: string) {
    try {
      await action();
      toast.success(successMsg);
      setAdjustFor(null);
      setBalanceFor(null);
      setExpiryFor(null);
      setCrossLocationFor(null);
      setHomeLocationFor(null);
      setBoundInstructorFor(null);
      setRefundFor(null);
      setWorkshopRefundFor(null);
      setCancelBookingFor(null);
      setGiveOpen(false);
      setRemoveFor(null);
      setEmailOpen(false);
      setProfileOpen(false);
      setOpenPurchaseRefundFor(null);
      await load();
    } catch (err) {
      const body =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as { error?: unknown; message?: unknown })
          : {};
      const code = body.error !== undefined ? String(body.error) : "";
      const msg =
        REFUSALS[code] ??
        // A refusal the page has no sentence for may carry the server's own.
        (body.message !== undefined ? String(body.message) : null) ??
        (err instanceof ApiError ? `Update failed (HTTP ${err.status}).` : "Update failed.");
      toast.error(msg);
    }
  }

  /**
   * Issue a Refund and say what happened (#275). A Refund that Stripe took for
   * some payments and refused for the next is not an error — money moved — so
   * it is a warning naming how much went back. A refusal is reloaded after, so
   * a purchase refunded in another tab stops offering the button.
   */
  async function runRefund(kind: RefundKind, issue: () => Promise<ApiRefundReply>) {
    try {
      const res = await issue();
      const t = refundReplyToast(kind, res, res.returned_line);
      if (t.tone === "warning") toast.warning(t.message, { duration: 15000 });
      else toast.success(t.message);
      setRefundFor(null);
      setWorkshopRefundFor(null);
      setOpenPurchaseRefundFor(null);
    } catch (err) {
      toast.error(refundFailureMessage(err instanceof ApiError ? err.body : null));
    }
    await load();
  }

  function onPackageAction(action: PackageAction, p: ApiPackage) {
    const open: Record<PackageAction, (p: ApiPackage) => void> = {
      balance: setBalanceFor,
      expiry: setExpiryFor,
      cross_location: setCrossLocationFor,
      home_location: setHomeLocationFor,
      bound_instructor: setBoundInstructorFor,
      adjust: setAdjustFor,
      refund: setRefundFor,
      remove: setRemoveFor,
    };
    open[action](p);
  }

  const blocked = Boolean(profile?.deleted_at);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin/customers"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All customers
      </Link>

      {loading && !profile ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading customer…
        </div>
      ) : error || !profile ? (
        <div className="rounded-xl border border-error/30 bg-error/5 p-8 text-center">
          <p className="text-sm text-error">{error ?? "Could not load customer."}</p>
          <Button size="sm" variant="ghost" onClick={load} className="mt-2">
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {!canEdit && (
            <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
              Read-only view — only admins can modify customer packages and credits.
            </div>
          )}

          {profile.deleted_at && (
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium text-error">
                  Blocked {formatRelative(profile.deleted_at)}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  This customer cannot sign in. Bookings, packages, and credit
                  history are preserved. Admins can unblock them.
                </div>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={restoring}
                  onClick={async () => {
                    if (!api) return;
                    setRestoring(true);
                    try {
                      await api.post(`/portal/admin/clients/${id}/restore`, {});
                      toast.success("Customer unblocked.");
                      await load();
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError
                          ? `Unblock failed (HTTP ${err.status}).`
                          : "Unblock failed.",
                      );
                    } finally {
                      setRestoring(false);
                    }
                  }}
                >
                  {restoring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Unblock
                </Button>
              )}
            </div>
          )}

          {/* Who they are and how they turn up — the two things the front desk
              reads first. Everything that changes their account sits in the
              side column, away from the name. */}
          <header className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
              <Avatar name={profile.name} size={56} className="text-sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold break-words text-ink sm:text-2xl">
                    {profile.name}
                  </h1>
                  {profile.deleted_at ? (
                    <Badge tone="error">
                      <ShieldOff className="mr-1 h-3 w-3" /> Blocked
                    </Badge>
                  ) : (
                    <Badge tone="sage">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Active
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
                  <a
                    href={`mailto:${profile.email}`}
                    className="inline-flex min-w-0 items-center gap-1.5 break-all hover:text-ink"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0" /> {profile.email}
                  </a>
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" /> {profile.phone || "—"}
                  </span>
                  {/* Beside the contact details, because an unsigned waiver is
                      the one thing that stops a member being checked in. */}
                  {profile.waiver_signed_at ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FileCheck className="h-3.5 w-3.5 shrink-0" /> Waiver signed{" "}
                      {formatDate(profile.waiver_signed_at, "d MMM yyyy")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-warning">
                      <FileWarning className="h-3.5 w-3.5 shrink-0" /> Waiver not signed
                    </span>
                  )}
                </div>
              </div>
              {/* The address the member signs in with (#176) — beside the one
                  the header shows, because that is the thing being changed. */}
              {canEdit && !blocked && (
                // A full-width pair under the name on a phone; beside it from sm up.
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => setProfileOpen(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit profile
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEmailOpen(true)}>
                    <Mail className="h-3.5 w-3.5" /> Change email
                  </Button>
                </div>
              )}
            </div>
            <AttendanceStrip attendance={profile.attendance} />
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <div className="min-w-0 space-y-6">
              {/* Unfinished purchases — money held against nothing granted (#93).
                  First, because it is the thing a member's arrival at the front
                  desk turns into a question. */}
              {profile.open_purchases.length > 0 && (
                <Section title="Partial payments" count={profile.open_purchases.length}>
                  <OpenPurchaseList
                    purchases={profile.open_purchases}
                    canEdit={canEdit}
                    onRefund={setOpenPurchaseRefundFor}
                  />
                </Section>
              )}

              <Section
                title="Packages & memberships"
                count={profile.packages.length}
                aside={
                  // A **Complimentary Package** (#176) — beside the wallet it
                  // lands in, not among the account actions.
                  canEdit && !blocked ? (
                    <Button size="sm" variant="secondary" onClick={() => setGiveOpen(true)}>
                      <Gift className="h-3.5 w-3.5" /> Give package
                    </Button>
                  ) : null
                }
              >
                {profile.packages.length === 0 ? (
                  <EmptyLine>No current packages.</EmptyLine>
                ) : (
                  <PackageGrid list={profile.packages} canEdit={canEdit} onAction={onPackageAction} />
                )}
                {/* Folded away until asked for. A past package keeps its
                    actions: an expired pack can still be extended or refunded. */}
                {profile.past_packages.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setShowPastPackages((v) => !v)}
                      className="inline-flex min-h-9 items-center gap-1 rounded text-xs font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-expanded={showPastPackages}
                    >
                      {showPastPackages ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {showPastPackages ? "Hide" : "Show"} past packages ({profile.past_packages.length})
                      <span className="hidden font-normal sm:inline">— expired, used up or refunded</span>
                    </button>
                    {showPastPackages && (
                      <div className="mt-3">
                        <PackageGrid
                          list={profile.past_packages}
                          canEdit={canEdit}
                          onAction={onPackageAction}
                        />
                      </div>
                    )}
                  </div>
                )}
              </Section>

              <BookingsSection
                upcoming={profile.upcoming_bookings}
                past={profile.past_bookings}
                onCancel={canEdit ? setCancelBookingFor : undefined}
              />

              <PaymentsSection payments={profile.payments} />

              {profile.workshop_purchases.length > 0 && (
                <Section title="Workshop purchases" count={profile.workshop_purchases.length}>
                  <WorkshopPurchaseList
                    purchases={profile.workshop_purchases}
                    canEdit={canEdit}
                    onRefund={setWorkshopRefundFor}
                  />
                </Section>
              )}

              {profile.adjustments.length > 0 && (
                <Section title="Package adjustments" count={profile.adjustments.length}>
                  <AdjustmentList
                    adjustments={profile.adjustments}
                    packages={[...profile.packages, ...profile.past_packages]}
                  />
                </Section>
              )}
            </div>

            <aside className="min-w-0 space-y-6">
              <DetailsCard profile={profile} />

              {/* Remounted by the block state: blocking ends their sessions too. */}
              <SessionsPanel
                path={`/portal/admin/clients/${id}`}
                canRevoke={canEdit}
                refreshKey={profile.deleted_at}
                actions={
                  canEdit && !blocked ? (
                    <SendSetPasswordButton clientId={id} email={profile.email} />
                  ) : null
                }
              />

              {canEdit && (
                <Section title="Account">
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
                    <AccountAction
                      icon={exporting ? Loader2 : Download}
                      spin={exporting}
                      label="Download data"
                      hint="Everything the studio holds about them, as a .zip."
                      disabled={exporting}
                      onClick={downloadData}
                    />
                    {!blocked && (
                      <AccountAction
                        icon={ShieldOff}
                        danger
                        label="Block"
                        hint="Stops them signing in. Their history is kept."
                        onClick={() => setDeleteOpen(true)}
                      />
                    )}
                    <AccountAction
                      icon={Trash2}
                      danger
                      label="Delete permanently"
                      hint="Removes them for good. Cannot be undone."
                      onClick={() => setPermanentDeleteOpen(true)}
                    />
                  </div>
                </Section>
              )}
            </aside>
          </div>
        </div>
      )}

      {canEdit && adjustFor && (
        <AdjustmentDialog
          pkg={adjustFor}
          onSubmit={(delta, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${adjustFor.id}/adjust`, {
                  delta,
                  reason,
                }),
              "Balance adjusted.",
            )
          }
          onClose={() => setAdjustFor(null)}
        />
      )}

      {canEdit && balanceFor && (
        <PackageSetBalanceDialog
          pkg={toClientPackage(id, balanceFor)}
          onSave={(newBal, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${balanceFor.id}/balance`, {
                  balance: newBal,
                  reason,
                }),
              "Balance updated.",
            )
          }
          onClose={() => setBalanceFor(null)}
        />
      )}

      {canEdit && expiryFor && (
        <PackageExpiryDialog
          pkg={toClientPackage(id, expiryFor)}
          onSave={(newExp, reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${expiryFor.id}/expiry`, {
                  expires_at: newExp,
                  reason,
                }),
              "Expiry updated.",
            )
          }
          onClose={() => setExpiryFor(null)}
        />
      )}

      {canEdit && crossLocationFor && (
        <CrossLocationDialog
          packageName={crossLocationFor.package_name}
          currentPaidSgd={crossLocationFor.cross_location_paid_sgd}
          onSave={(paidSgd, reason) =>
            runEdit(
              () =>
                api!.post(
                  `/portal/admin/clients/${id}/packages/${crossLocationFor.id}/cross-location`,
                  { paid_sgd: paidSgd, reason },
                ),
              "Cross-Location Add-On updated.",
            )
          }
          onClose={() => setCrossLocationFor(null)}
        />
      )}

      {canEdit && homeLocationFor && (
        <HomeLocationDialog
          packageName={homeLocationFor.package_name}
          currentLocation={homeLocationFor.unlimited_location}
          onSave={(locationId, reason) =>
            runEdit(
              () =>
                api!.post(
                  `/portal/admin/clients/${id}/packages/${homeLocationFor.id}/location`,
                  { location_id: locationId, reason },
                ),
              "Home studio moved. Existing bookings are unchanged.",
            )
          }
          onClose={() => setHomeLocationFor(null)}
        />
      )}

      {canEdit && boundInstructorFor && (
        <BoundInstructorDialog
          packageName={boundInstructorFor.package_name}
          currentInstructor={boundInstructorFor.bound_instructor}
          onSave={(instructorId, reason) =>
            runEdit(
              () =>
                api!.post(
                  `/portal/admin/clients/${id}/packages/${boundInstructorFor.id}/bound-instructor`,
                  { instructor_id: instructorId, reason },
                ),
              "Bound instructor updated. Scheduled sessions are unchanged.",
            )
          }
          onClose={() => setBoundInstructorFor(null)}
        />
      )}

      {canEdit && refundFor && (
        <RefundDialog
          packageName={refundFor.package_name}
          facts={{
            kind: "package",
            amountSgd: refundFor.refund_amount_sgd,
            crossLocationPaidSgd: refundFor.cross_location_paid_sgd,
            includesAddOn: refundFor.refund_includes_add_on,
            upcomingBookingCount: refundFor.refund_upcoming_booking_count,
            promoCode: refundFor.refund_promo_code,
          }}
          notice={refundFor.refund_notice}
          paymentCount={refundFor.refund_payment_count}
          onConfirm={(reason) =>
            runRefund("package", () =>
              api!.post<ApiRefundReply>(
                `/portal/admin/clients/${id}/packages/${refundFor.id}/refund`,
                { reason },
              ),
            )
          }
          onClose={() => setRefundFor(null)}
        />
      )}

      {canEdit && workshopRefundFor && (
        <RefundDialog
          packageName={workshopRefundFor.workshop_name}
          facts={{
            kind: "workshop",
            amountSgd: workshopRefundFor.refund_amount_sgd,
            promoCode: workshopRefundFor.refund_promo_code,
          }}
          notice={workshopRefundFor.refund_notice}
          paymentCount={workshopRefundFor.refund_payment_count}
          onConfirm={(reason) =>
            runRefund("workshop", () =>
              api!.post<ApiRefundReply>(
                `/portal/admin/clients/${id}/workshop-bookings/${workshopRefundFor.booking_id}/refund`,
                { reason },
              ),
            )
          }
          onClose={() => setWorkshopRefundFor(null)}
        />
      )}

      {canEdit && cancelBookingFor && (
        <CancelBookingDialog
          booking={cancelBookingFor}
          onConfirm={() =>
            runEdit(
              () => api!.post(`/portal/admin/bookings/${cancelBookingFor.booking_id}/cancel`),
              "Booking cancelled.",
            )
          }
          onClose={() => setCancelBookingFor(null)}
        />
      )}

      {canEdit && giveOpen && profile && (
        <GivePackageDialog
          memberName={profile.name}
          onGive={(payload: GivePackagePayload) =>
            runEdit(
              () => api!.post(`/portal/admin/clients/${id}/packages/issue`, payload),
              "Package given. It waits until their first booking.",
            )
          }
          onClose={() => setGiveOpen(false)}
        />
      )}

      {canEdit && removeFor && (
        <RemovePackageDialog
          packageName={removeFor.package_name}
          onConfirm={(reason) =>
            runEdit(
              () =>
                api!.post(`/portal/admin/clients/${id}/packages/${removeFor.id}/remove`, {
                  reason,
                }),
              "Free package removed.",
            )
          }
          onClose={() => setRemoveFor(null)}
        />
      )}

      {canEdit && emailOpen && profile && (
        <ChangeEmailDialog
          memberName={profile.name}
          currentEmail={profile.email}
          onSave={(email) =>
            runEdit(
              () => api!.post(`/portal/admin/clients/${id}/email`, { email }),
              "Email changed. The member signs in with the new address.",
            )
          }
          onClose={() => setEmailOpen(false)}
        />
      )}

      {canEdit && profileOpen && profile && (
        <EditProfileDialog
          current={{ name: profile.name, phone: profile.phone, gender: profile.gender }}
          onSave={(edit) =>
            runEdit(
              () => api!.patch(`/portal/admin/clients/${id}/profile`, edit),
              "Profile saved.",
            )
          }
          onClose={() => setProfileOpen(false)}
        />
      )}

      {/* An unfinished purchase (#95). Aimed at the Purchase itself, because
          there is no plan and no booking to aim it at. The reply names how many
          payments went back and what they totalled, so an admin can reconcile
          it against the statement without opening the provider's dashboard. */}
      {canEdit && openPurchaseRefundFor && (
        <RefundDialog
          packageName={openPurchaseRefundFor.item_name}
          facts={{ kind: "unfinished", amountSgd: openPurchaseRefundFor.paid_sgd }}
          notice={null}
          paymentCount={openPurchaseRefundFor.refund_payment_count}
          onConfirm={(reason) =>
            // The reply carries the backend's own sentence — "2 payments
            // returned, totalling S$120.00". The number of lines the statement
            // will grow by is the thing an admin has to reconcile, and it is
            // not derivable from the amount alone.
            runRefund("unfinished", () =>
              api!.post<ApiRefundReply>(
                `/portal/admin/purchases/${openPurchaseRefundFor.id}/refund`,
                { reason },
              ),
            )
          }
          onClose={() => setOpenPurchaseRefundFor(null)}
        />
      )}

      {canEdit && deleteOpen && profile && (
        <BlockClientDialog
          email={profile.email}
          name={profile.name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            if (!api) return;
            try {
              await api.del(`/portal/admin/clients/${id}`);
              toast.success("Customer blocked.");
              setDeleteOpen(false);
              await load();
            } catch (err) {
              toast.error(
                err instanceof ApiError
                  ? `Block failed (HTTP ${err.status}).`
                  : "Block failed.",
              );
            }
          }}
        />
      )}

      {canEdit && permanentDeleteOpen && profile && (
        <DeleteClientDialog
          email={profile.email}
          name={profile.name}
          exporting={exporting}
          onDownload={downloadData}
          onClose={() => setPermanentDeleteOpen(false)}
          onConfirm={async () => {
            if (!api) return;
            try {
              await api.del(`/portal/admin/clients/${id}/permanently`);
              toast.success("Customer deleted.");
              router.replace("/admin/customers");
            } catch (err) {
              toast.error(
                err instanceof ApiError
                  ? `Delete failed (HTTP ${err.status}).`
                  : "Delete failed.",
              );
            }
          }}
        />
      )}
    </div>
  );
}

/** One heading style for every block on the page: title, count, one action. */
function Section({
  title,
  count,
  aside,
  children,
}: {
  title: string;
  count?: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex min-h-8 items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-warm px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted">
            {count}
          </span>
        )}
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** Nothing here yet — one quiet line, not a card-sized hole in the page. */
function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
      {children}
    </div>
  );
}

/** A pager under a grid of cards, which has no card of its own to sit in. */
const GRID_PAGER = "mt-3 rounded-xl border border-border bg-card";

/** Attendance over every booking ever — the backend counts, not the lists below. */
function AttendanceStrip({ attendance }: { attendance: ApiAttendance }) {
  const cells = [
    { label: "Attended", value: String(attendance.attended), warn: false },
    { label: "No-shows", value: String(attendance.no_shows), warn: attendance.no_shows > 0 },
    { label: "Late cancels", value: String(attendance.late_cancels), warn: attendance.late_cancels > 0 },
    {
      label: "Last visit",
      value: attendance.last_attended_at
        ? formatDate(attendance.last_attended_at, "d MMM yyyy")
        : "No visits yet",
      warn: false,
    },
  ];
  return (
    <dl className="grid grid-cols-2 border-t border-border bg-paper/50 sm:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cn(
            "px-5 py-3 sm:px-6",
            i % 2 === 1 && "border-l border-border",
            i >= 2 && "border-t border-border sm:border-t-0",
            i === 2 && "sm:border-l",
          )}
        >
          <dt className="text-xs text-muted">{c.label}</dt>
          <dd
            className={cn(
              "mt-0.5 font-semibold tabular-nums",
              i < 3 ? "text-xl" : "text-base leading-7",
              c.warn ? "text-warning" : "text-ink",
            )}
          >
            {c.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The quieter facts about the member, out of the header so it stays short. */
function DetailsCard({ profile }: { profile: ApiProfile }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Joined", value: formatDate(profile.joined_at, "d MMM yyyy") },
  ];
  // Prefer not to say is shown, not hidden: "not said" is an answer, and
  // hiding it would read as "never asked".
  if (profile.gender) {
    rows.push({ label: "Gender", value: GENDER_LABEL[profile.gender] });
  }
  if (profile.dob) rows.push({ label: "Born", value: formatDate(profile.dob, "d MMM yyyy") });
  if (profile.referred_by) {
    rows.push({
      label: "Referred by",
      value: (
        <Link
          href={`/admin/customers/${profile.referred_by.id}`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {profile.referred_by.name}
        </Link>
      ),
    });
  }
  return (
    <Section title="Details">
      <dl className="divide-y divide-border rounded-xl border border-border bg-card text-sm shadow-soft">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className="min-w-0 truncate text-right text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function AccountAction({
  icon: Icon,
  spin,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  spin?: boolean;
  label: string;
  hint: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors disabled:opacity-60",
        danger ? "hover:bg-error/5" : "hover:bg-paper",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          danger ? "text-error" : "text-muted",
          spin && "animate-spin",
        )}
      />
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", danger ? "text-error" : "text-ink")}>
          {label}
        </span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function PackageGrid({
  list,
  canEdit,
  onAction,
}: {
  list: ApiPackage[];
  canEdit: boolean;
  onAction: (action: PackageAction, p: ApiPackage) => void;
}) {
  const { visible, pagination } = usePaged(list);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((p) => (
          <PackageCard key={p.id} p={p} canEdit={canEdit} onAction={onAction} />
        ))}
      </div>
      <Pagination {...pagination} noun="packages" className={GRID_PAGER} />
    </>
  );
}

const KIND_BADGE: Record<PackageKind, { label: string; tone: "accent" | "warning" | "sage" | "cyan" }> = {
  credit_bundle: { label: "Credit", tone: "accent" },
  unlimited: { label: "Unlimited", tone: "warning" },
  trial: { label: "Trial", tone: "sage" },
  pt: { label: "PT", tone: "cyan" },
};

function PackageCard({
  p,
  canEdit,
  onAction,
}: {
  p: ApiPackage;
  canEdit: boolean;
  onAction: (action: PackageAction, p: ApiPackage) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const actions = canEdit ? packageActions(p) : [];
  const kind = KIND_BADGE[p.kind];
  const standing = STANDING_BADGE[p.standing];
  const current = p.standing === "running" || p.standing === "dormant";

  // A click anywhere else, or Escape, closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const remaining = p.credits_or_sessions_remaining;
  const total = p.credits_or_sessions_total;
  const share = remaining !== null && total ? Math.max(0, Math.min(1, remaining / total)) : null;
  const unit = p.kind === "pt" ? "sessions" : "credits";

  const validity = p.expires_at
    ? `${p.standing === "expired" ? "Expired" : "Valid until"} ${formatDate(p.expires_at, "d MMM yyyy")}`
    : p.dormant
      ? "Starts at first booking"
      : "No expiry";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border border-border bg-card p-4 shadow-soft",
        !current && "bg-card/70",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words text-ink">{p.package_name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={kind.tone}>{kind.label}</Badge>
            {/* Said on the card, because "paid S$0" below reads as a full
                discount otherwise, and this one was a gift. */}
            {p.complimentary && <Badge tone="neutral">Free</Badge>}
            {standing && <Badge tone={standing.tone}>{standing.label}</Badge>}
            {refundProgressBadge(p.refund_progress)}
          </div>
        </div>
        {actions.length > 0 && (
          <div ref={menuRef} className="relative -mr-1 -mt-1">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Actions for ${p.package_name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-10 z-20 w-56 max-w-[calc(100vw-2.5rem)] rounded-lg border border-border bg-card p-1 shadow-modal"
              >
                {actions.map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onAction(a.action, p);
                    }}
                    className={cn(
                      "block w-full rounded-md px-3 py-2.5 text-left text-sm hover:bg-paper sm:py-2",
                      (a.action === "refund" || a.action === "remove") && "text-error",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* The balance is what the front desk came here for, so it is the
          largest thing on the card. */}
      <div className="mt-4">
        {remaining !== null ? (
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold tabular-nums text-ink">{remaining}</span>
            {total !== null && <span className="text-sm tabular-nums text-muted">/ {total}</span>}
            <span className="ml-1 text-xs text-muted">{unit} left</span>
          </div>
        ) : (
          <div className="text-2xl font-semibold text-ink">Unlimited</div>
        )}
        {share !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-warm">
            <div
              className={cn(
                "h-full rounded-full",
                !current ? "bg-muted/40" : remaining !== null && remaining <= 1 ? "bg-warning" : "bg-accent",
              )}
              style={{ width: `${share * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-3 space-y-0.5 text-xs text-muted">
        <div>
          {validity}
          {p.unlimited_location ? ` · ${p.unlimited_location.name}` : ""}
          {p.cross_location_paid_sgd !== null
            ? ` · both studios (Add-On S$${p.cross_location_paid_sgd})`
            : ""}
        </div>
        {/* Stated on every PT Package, open ones included — "open to any
            instructor" is a fact about the package, and an absent line would
            read as one nobody had checked. */}
        {p.kind === "pt" && (
          <div>
            {p.bound_instructor
              ? `Sessions with ${p.bound_instructor.name}`
              : "Open to any instructor"}
          </div>
        )}
        {/* List Price and the money off derived from it. That figure is NOT
            stored and NOT sent — a third number would be free to disagree with
            the two that matter. A package with no online payment behind it and
            not given free (one brought over when the studio moved here) shows
            what the old system recorded, with no discount derived. */}
        {!p.paid_online && !p.complimentary ? (
          <div>
            Bought {formatDate(p.purchased_at, "d MMM yyyy")} · paid S${p.amount_paid_sgd} · no
            online payment on record
          </div>
        ) : (
          <div>
            Bought {formatDate(p.purchased_at, "d MMM yyyy")} · List S${p.list_price_sgd} · paid S$
            {p.amount_paid_sgd}
            {discountOff(p.list_price_sgd, p.amount_paid_sgd) && (
              <span className="text-ink">
                {" "}
                · {discountOff(p.list_price_sgd, p.amount_paid_sgd)} off
              </span>
            )}
            {p.promo_code && (
              <span>
                {" "}
                · code <span className="text-ink">{p.promo_code}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* The attended notice sits on the card itself, above the Refund action,
          and again in the dialog. It is a notice and not a gate (§14). */}
      {p.refundable && p.refund_notice && (
        <div className="mt-2 inline-flex items-start gap-1 text-xs text-warning">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {p.refund_notice}
        </div>
      )}
    </div>
  );
}

function OpenPurchaseList({
  purchases,
  canEdit,
  onRefund,
}: {
  purchases: ApiOpenPurchase[];
  canEdit: boolean;
  onRefund: (p: ApiOpenPurchase) => void;
}) {
  const { visible, pagination } = usePaged(purchases);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-warning/40 bg-warning/5 px-5 py-4 shadow-soft"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{p.item_name}</p>
                {p.refund_progress !== "none" && (
                  <div className="mt-1">{refundProgressBadge(p.refund_progress)}</div>
                )}
                <p className="mt-1 text-xs text-muted">
                  S${p.paid_sgd} paid of S${p.total_sgd}
                  {p.part_paid_at ? ` · since ${formatDate(p.part_paid_at)}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-semibold text-ink">S${p.outstanding_sgd}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted">Outstanding</p>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-ink">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              <span>
                Grants nothing — no plan, no credits, no place held. Do not check this member
                in against it.
              </span>
            </p>
            {/* The money's only way out (#95). Nothing was delivered, so there
                is no plan to void and no booking to cancel — the refund closes
                the purchase and that is all it does. */}
            {canEdit && p.refund_progress !== "processing" && (
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRefund(p)}
                  className="text-error hover:bg-error/10 hover:text-error"
                >
                  Refund S${p.paid_sgd}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination {...pagination} noun="purchases" className={GRID_PAGER} />
    </>
  );
}

function WorkshopPurchaseList({
  purchases,
  canEdit,
  onRefund,
}: {
  purchases: ApiWorkshopPurchase[];
  canEdit: boolean;
  onRefund: (w: ApiWorkshopPurchase) => void;
}) {
  const { visible, pagination } = usePaged(purchases);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((w) => (
          <div key={w.booking_id} className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="font-medium break-words text-ink">{w.workshop_name}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="cyan">Workshop</Badge>
              {w.cancelled && w.refund_progress === "none" && (
                <Badge tone="warning">Cancelled · not refunded</Badge>
              )}
              {refundProgressBadge(w.refund_progress)}
              {w.tier_name && <span className="text-xs text-muted">{w.tier_name}</span>}
            </div>
            <div className="mt-3 text-xs text-muted">
              List S${w.list_price_sgd} · paid S${w.amount_paid_sgd}
              {discountOff(w.list_price_sgd, w.amount_paid_sgd) && (
                <span className="text-ink">
                  {" "}
                  · {discountOff(w.list_price_sgd, w.amount_paid_sgd)} off
                </span>
              )}
            </div>
            {/* Same notice-not-gate treatment as the package cards (§14). */}
            {w.refundable && w.refund_notice && (
              <div className="mt-1 inline-flex items-start gap-1 text-xs text-warning">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {w.refund_notice}
              </div>
            )}
            {canEdit && w.refundable && w.refund_progress !== "processing" && (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-error hover:bg-error/10 hover:text-error"
                  onClick={() => onRefund(w)}
                >
                  Refund purchase…
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination {...pagination} noun="workshop purchases" className={GRID_PAGER} />
    </>
  );
}

function AdjustmentList({
  adjustments,
  packages,
}: {
  adjustments: ApiAdjustment[];
  packages: ApiPackage[];
}) {
  const { visible, pagination } = usePaged(adjustments);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <ul className="divide-y divide-border">
        {visible.map((a) => {
          const pkg = packages.find((p) => p.id === a.client_package_id);
          const isExpiry = a.reason.startsWith("Expiry");
          const isSet = a.reason.startsWith("Set ");
          const badge = isExpiry ? (
            <Badge tone="neutral">Expiry</Badge>
          ) : isSet ? (
            <Badge tone="accent">Set</Badge>
          ) : (
            <Badge tone={a.delta > 0 ? "sage" : "error"}>
              {a.delta > 0 ? "+" : ""}
              {a.delta}
            </Badge>
          );
          return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <div className="w-14 shrink-0">{badge}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink">{pkg?.package_name ?? "Package"}</div>
                <div className="text-xs text-muted">{a.reason}</div>
              </div>
              <span className="shrink-0 text-xs text-muted">{formatRelative(a.created_at)}</span>
            </li>
          );
        })}
      </ul>
      <Pagination {...pagination} noun="adjustments" />
    </div>
  );
}

/**
 * Permanent deletion (#144), beside blocking. Nothing about the member is left
 * to restore, so the dialog offers the download first and asks for the email
 * typed out, as blocking does.
 */
function DeleteClientDialog({
  email,
  name,
  exporting,
  onDownload,
  onClose,
  onConfirm,
}: {
  email: string;
  name: string;
  exporting: boolean;
  onDownload: () => Promise<void>;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${name} permanently?`}
      description="Everything this studio holds about them is deleted and cannot be restored. Payments, refunds and package sales stay in your accounts with their name removed. If they only want to stop booking, block them instead."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches || busy) return;
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-paper px-3 py-2 text-sm">
          <span className="text-muted">Answering a data request? Download their data first.</span>
          <Button type="button" variant="ghost" size="sm" onClick={onDownload} disabled={exporting || busy}>
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download data
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-delete-email">
            Type <span className="text-ink">{email}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-email"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!matches || busy}
            className="bg-error text-white hover:bg-error/90"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Delete permanently
              </>
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function BlockClientDialog({
  email,
  name,
  onClose,
  onConfirm,
}: {
  email: string;
  name: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Block ${name}?`}
      description="The customer will be locked out of the booking app and hidden from the directory. Bookings, packages, and credit history are kept. An admin can unblock them later."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches || busy) return;
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="confirm-email">
            Type <span className="text-ink">{email}</span> to confirm
          </Label>
          <Input
            id="confirm-email"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!matches || busy}
            className="bg-error text-white hover:bg-error/90"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Blocking…
              </>
            ) : (
              <>
                <ShieldOff className="h-4 w-4" /> Block customer
              </>
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function AdjustmentDialog({
  pkg,
  onSubmit,
  onClose,
}: {
  pkg: ApiPackage;
  onSubmit: (delta: number, reason: string) => void;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Manual adjustment — ${pkg.package_name}`}
      description="Use a signed integer (e.g. +3 or −1). Audit-logged with your name."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(delta);
          if (!n || !reason.trim()) return;
          onSubmit(n, reason.trim());
        }}
      >
        <div className="text-sm text-muted">
          Current balance:{" "}
          <strong className="text-ink">{pkg.credits_or_sessions_remaining ?? 0}</strong>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delta">Adjustment</Label>
          <Input
            id="delta"
            required
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="+1, -2, …"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <textarea
            id="reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Free text — required for the audit log."
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Apply adjustment</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const GENDER_LABEL: Record<"female" | "male" | "non_binary" | "prefer_not_to_say", string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

function bookingTitle(b: ApiBooking): string {
  if (b.kind === "pt") return b.session_type === "2on1" ? "Private session (2-on-1)" : "Private session";
  if (b.kind === "workshop") return b.tier_name ? `${b.title ?? "Workshop"} · ${b.tier_name}` : (b.title ?? "Workshop");
  return b.title ?? "Class";
}

/**
 * What a cancellation did with what the member paid, read off the booking's
 * refund outcome (#272). A bare "Cancelled" hid the one thing the front desk is
 * asked about. `n_a` on a workshop is a place cancelled with its Workshop and
 * no money back yet; on a class it is an Unlimited plan's, which spent nothing.
 */
function cancelledOutcome(b: ApiBooking): { label: string; tone: "warning" | "neutral" } {
  switch (b.refund_outcome) {
    case "forfeited":
      return { label: "Late cancel", tone: "warning" };
    case "stripe_refunded":
      return { label: "Cancelled · refunded", tone: "neutral" };
    case "credit_returned":
      return { label: "Cancelled · credit back", tone: "neutral" };
    case "session_returned":
      return { label: "Cancelled · session back", tone: "neutral" };
    case "n_a":
      return b.kind === "workshop"
        ? { label: "Cancelled · not refunded", tone: "warning" }
        : { label: "Cancelled · place freed", tone: "neutral" };
  }
}

/** How a booking ended, in the words the front desk uses. */
function bookingOutcome(b: ApiBooking, upcoming: boolean): { label: string; tone: "sage" | "warning" | "error" | "neutral" | "accent" } {
  if (b.state === "cancelled") return cancelledOutcome(b);
  if (b.check_in_state === "attended") return { label: "Attended", tone: "sage" };
  if (b.state === "no_show" || b.check_in_state === "no_show") return { label: "No-show", tone: "error" };
  if (upcoming) return { label: "Booked", tone: "accent" };
  // In the past, still confirmed and never checked in — nobody marked it.
  return { label: "Not checked in", tone: "neutral" };
}

function BookingRow({
  b,
  upcoming,
  onCancel,
}: {
  b: ApiBooking;
  upcoming: boolean;
  /** Offered only on an upcoming booking the backend says can be cancelled. */
  onCancel?: (b: ApiBooking) => void;
}) {
  const outcome = bookingOutcome(b, upcoming);
  const detail = [b.instructor, b.location, b.package_name ? `on ${b.package_name}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    // On a phone the outcome and Cancel drop under the title rather than
    // squeezing it to a few letters; from sm up they sit at the row's end.
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <div className="w-20 shrink-0 text-xs tabular-nums text-muted sm:w-28">
          {b.starts_at ? (
            <>
              <div className="font-medium text-ink">{formatDate(b.starts_at, "d MMM yyyy")}</div>
              <div>{formatDate(b.starts_at, "EEE h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase())}</div>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{bookingTitle(b)}</div>
          {detail && (
            <div className="truncate text-xs text-muted" title={detail}>
              {detail}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 pl-[5.75rem] sm:w-auto sm:shrink-0 sm:pl-0">
        <Badge tone={outcome.tone}>{outcome.label}</Badge>
        {onCancel && upcoming && b.cancel_notice && (
          <Button
            size="sm"
            variant="ghost"
            className="text-error hover:bg-error/10 hover:text-error"
            onClick={() => onCancel(b)}
          >
            Cancel…
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * An admin's cancel of one class booking (#272). Always allowed and always
 * returns what the booking spent — the dialog says which, in the backend's
 * words, before the admin commits.
 */
function CancelBookingDialog({
  booking,
  onConfirm,
  onClose,
}: {
  booking: ApiBooking;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const when = booking.starts_at
    ? ` on ${formatDate(booking.starts_at, "EEE d MMM, h:mma").replace(/(AM|PM)/, (m) => m.toLowerCase())}`
    : "";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={`Cancel ${bookingTitle(booking)}${when}?`}
      description={`Their place is released. ${booking.cancel_notice ?? ""}`}
    >
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Keep booking
        </Button>
        <Button
          type="button"
          disabled={busy}
          className="bg-error text-white hover:bg-error/90"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
            </>
          ) : (
            "Cancel booking"
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * What the member has booked and what they did with it, as two tabs of one
 * card. Upcoming in full; history is the most recent the backend sends (the
 * attendance strip in the header counts every one). Cancelled bookings stay in
 * the history — a late cancel is exactly what the front desk looks here for.
 */
function BookingsSection({
  upcoming,
  past,
  onCancel,
}: {
  upcoming: ApiBooking[];
  past: ApiBooking[];
  /** Absent for a read-only viewer. */
  onCancel?: (b: ApiBooking) => void;
}) {
  const [tab, setTab] = useState<"upcoming" | "history">(
    upcoming.length > 0 || past.length === 0 ? "upcoming" : "history",
  );
  const list = tab === "upcoming" ? upcoming : past;
  const { visible, pagination } = usePaged(list, tab);
  const tabs = [
    { id: "upcoming" as const, label: "Upcoming", count: upcoming.length },
    { id: "history" as const, label: "History", count: past.length },
  ];
  return (
    <Section title="Bookings">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div role="tablist" aria-label="Bookings" className="flex items-center gap-5 border-b border-border px-4 sm:px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                tab === t.id
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
              <span className="rounded-full bg-warm px-1.5 text-[11px] tabular-nums text-muted">
                {t.count}
              </span>
            </button>
          ))}
          {tab === "history" && past.length > 0 && (
            <span className="ml-auto text-xs text-muted">Latest {past.length}</span>
          )}
        </div>
        {list.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-muted">
            {tab === "upcoming" ? "Nothing booked." : "No past bookings."}
          </div>
        ) : (
          <ul role="tabpanel" className="divide-y divide-border">
            {visible.map((b) => (
              <BookingRow key={b.booking_id} b={b} upcoming={tab === "upcoming"} onCancel={onCancel} />
            ))}
          </ul>
        )}
        <Pagination {...pagination} noun="bookings" />
      </div>
    </Section>
  );
}

const PAYMENT_STATUS: Record<ApiPayment["status"], { label: string; tone: "sage" | "warning" | "error" | "neutral" }> = {
  succeeded: { label: "Paid", tone: "sage" },
  pending: { label: "Pending", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  failed: { label: "Failed", tone: "error" },
};

/**
 * Money that went through the payment provider. Packages that carry no online
 * payment — given free, or brought over from another system — show what was
 * paid on their own card above, so this list being empty is not "never paid".
 */
function PaymentsSection({ payments }: { payments: ApiPayment[] }) {
  const { visible, pagination } = usePaged(payments);
  return (
    <Section title="Online payments" count={payments.length}>
      {payments.length === 0 ? (
        <EmptyLine>
          No online payments. Imported and free packages show what was paid on their own card.
        </EmptyLine>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {visible.map((p) => {
              // Still "succeeded" until Stripe's confirmation lands (#275), and
              // "Paid" beside a Refund just issued reads as though it failed.
              const s = p.refund_processing
                ? { label: REFUND_PROCESSING_LABEL, tone: "warning" as const }
                : PAYMENT_STATUS[p.status];
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
                  <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
                    <div className="w-20 shrink-0 text-xs tabular-nums text-muted sm:w-28">
                      {formatDate(p.created_at, "d MMM yyyy")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink" title={p.item_name}>
                        {p.item_name}
                      </div>
                      {p.refunded_at && (
                        <div className="text-xs text-muted">
                          Refunded {formatDate(p.refunded_at, "d MMM yyyy")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex w-full items-center justify-end gap-3 pl-[5.75rem] sm:w-auto sm:shrink-0 sm:pl-0">
                    <span className="text-sm font-medium tabular-nums text-ink">S${p.amount_sgd}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {p.receipt_url && (
                      <a
                        href={p.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-8 items-center text-xs text-muted underline underline-offset-2 hover:text-ink"
                      >
                        Receipt
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination {...pagination} noun="payments" />
        </div>
      )}
    </Section>
  );
}
