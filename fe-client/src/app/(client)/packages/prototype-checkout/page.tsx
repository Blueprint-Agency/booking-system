"use client";

/**
 * THROWAWAY PROTOTYPE — issue #8, "Checkout with a location picker and the top-up upsell".
 *
 * Three variants of the Unlimited Plan purchase flow, switchable via `?variant=`,
 * mounted inside the real (client) layout so they butt against the real header,
 * real catalogue data and real density. Not linked from anywhere; delete with the ticket.
 *
 *   A — Configurator   the whole unlimited tab becomes a selection surface + sticky total bar
 *   B — Review page    catalogue unchanged, every choice happens on a dedicated review step
 *   C — Stepped modal  Purchase opens a forced two-step modal over the catalogue
 *
 * Below the variant, three states that are NOT being A/B'd (one design each, shown
 * under every variant): the blocked wrong-location class, the standalone Add-On
 * purchase with its ceil maths, and the Add-On with no plan to attach to.
 *
 * Nothing mutates. "Pay" prints the payload it would POST.
 */

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Lock, MapPin, X, ChevronRight, AlertCircle, Tag } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PrototypeSwitcher } from "@/components/ui/prototype-switcher";
import { usePackagesCatalog } from "@/lib/packages";
import { useLocations } from "@/lib/classes";

// ── Stubs the backend does not have yet ──────────────────────────────────────
// The rate lives on global_policy (ticket #7); locations/plan fall back to real
// values because staging holds zero unlimited packages (ticket #13).
const RATE_SGD = 30;
const FALLBACK_LOCATIONS = [
  { id: "loc-tai-seng", name: "Breadtalk IHQ", address: "30 Tai Seng St, Singapore 534013" },
  { id: "loc-outram", name: "Outram Park", address: "3 Cantonment Rd, Singapore 089741" },
];
const FALLBACK_PLANS = [
  { id: "plan-6m", name: "Unlimited 6 Months", months: 6, price: 1150 },
  { id: "plan-3m", name: "Unlimited 3 Months", months: 3, price: 650 },
];

type Plan = { id: string; name: string; months: number; price: number };
type Loc = { id: string; name: string; address: string | null };

const VARIANTS = [
  { key: "A", name: "Configurator" },
  { key: "B", name: "Review page" },
  { key: "C", name: "Stepped modal" },
];

// ── Shared bits ──────────────────────────────────────────────────────────────

function addOnPrice(months: number) {
  return Math.ceil(months) * RATE_SGD;
}

/** The maths, shown. Never a bare number — always how it was reached. */
function AddOnMaths({
  months,
  remainder,
  className,
}: {
  months: number;
  /** Set when pricing against a live plan whose remaining time is a part month. */
  remainder?: { endsOn: string; monthsLeft: number; daysLeft: number };
  className?: string;
}) {
  const charged = Math.ceil(months);
  return (
    <div className={cn("text-xs text-muted space-y-1", className)}>
      {remainder && (
        <p className="leading-relaxed">
          Your plan runs to <span className="text-ink font-medium">{remainder.endsOn}</span> —{" "}
          {remainder.monthsLeft} months, {remainder.daysLeft} days left. Part months are charged as
          whole months, so that&rsquo;s <span className="text-ink font-medium">{charged}</span>.
        </p>
      )}
      <p className="font-mono text-ink/70">
        {charged} month{charged === 1 ? "" : "s"} × {formatCurrency(RATE_SGD)}/month ={" "}
        <span className="font-semibold text-ink">{formatCurrency(charged * RATE_SGD)}</span>
      </p>
      <p>Expires with the plan it&rsquo;s attached to.</p>
    </div>
  );
}

function LocationOption({
  loc,
  selected,
  onSelect,
  size = "default",
}: {
  loc: Loc;
  selected: boolean;
  onSelect: () => void;
  size?: "default" | "large";
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border text-left transition-colors",
        size === "large" ? "p-5" : "px-4 py-3",
        selected
          ? "border-accent bg-accent/10 ring-1 ring-accent"
          : "border-ink/10 bg-paper hover:border-accent/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-accent bg-accent" : "border-ink/25",
        )}
      >
        {selected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium text-ink", size === "large" ? "text-base" : "text-sm")}>
          {loc.name}
        </span>
        {loc.address && <span className="mt-0.5 block text-xs text-muted">{loc.address}</span>}
      </span>
    </button>
  );
}

/** Where the choice is echoed back before payment — the "visible again at checkout" guard. */
function HomeLocationConfirm({ loc, plan }: { loc: Loc; plan: Plan }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-ink/10 bg-warm px-4 py-3 text-sm">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-deep" />
      <p className="leading-relaxed text-ink">
        Your home studio is <span className="font-semibold">{loc.name}</span> for the next{" "}
        {plan.months} months.
      </p>
    </div>
  );
}

function PayloadPanel({ payload }: { payload: object | null }) {
  if (!payload) return null;
  return (
    <div className="mt-6 rounded-xl border border-dashed border-ink/25 bg-ink/[0.03] p-4">
      <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">
        Would POST /me/checkout/package
      </p>
      <pre className="overflow-x-auto text-[11px] leading-relaxed text-ink/70">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

function Heading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

// ── Variant A — Configurator ─────────────────────────────────────────────────
// The unlimited tab stops being a shop window and becomes a form. Plan cards are
// radios, the studio picker appears under them, the Add-On is a companion card
// that is greyed until a plan is chosen, and a sticky bar carries the total.

function VariantA({ plans, locations }: { plans: Plan[]; locations: Loc[] }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [locId, setLocId] = useState<string | null>(null);
  const [addOn, setAddOn] = useState(false);
  const [payload, setPayload] = useState<object | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const loc = locations.find((l) => l.id === locId) ?? null;
  const total = (plan?.price ?? 0) + (plan && addOn ? addOnPrice(plan.months) : 0);
  const ready = Boolean(plan && loc);

  return (
    <div className="pb-32">
      <Heading
        title="Unlimited Access"
        note="Pick a plan, then the studio it covers. Everything on one screen."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((p) => {
          const selected = p.id === planId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanId(p.id)}
              aria-pressed={selected}
              className={cn(
                "rounded-2xl border p-6 text-left transition-all",
                selected
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-ink/10 bg-paper hover:-translate-y-0.5 hover:shadow-hover",
              )}
            >
              <p className="text-3xl font-extrabold text-ink">{p.months} months</p>
              <p className="mt-0.5 text-sm font-medium text-ink">{p.name}</p>
              <p className="mt-4 text-2xl font-bold text-ink">{formatCurrency(p.price)}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-muted">
                <li>Unlimited group classes</li>
                <li>One home studio, chosen below</li>
              </ul>
            </button>
          );
        })}

        {/* Companion Add-On card — greyed until a plan is chosen. */}
        <div
          className={cn(
            "rounded-2xl border p-6 transition-all sm:col-span-2",
            plan
              ? addOn
                ? "border-accent bg-accent/5 ring-1 ring-accent"
                : "border-ink/10 bg-paper"
              : "border-dashed border-ink/15 bg-warm/50",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", plan ? "text-ink" : "text-muted")}>
                Cross-Location Add-On
              </p>
              <p className="mt-1 text-sm text-muted">
                Practise at both Breadtalk IHQ and Outram Park, not just your home studio.
              </p>
              {plan ? (
                <AddOnMaths months={plan.months} className="mt-3" />
              ) : (
                <p className="mt-3 text-xs text-muted">
                  Choose a plan above and we&rsquo;ll price this for you —{" "}
                  {formatCurrency(RATE_SGD)} for every month of the plan.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={!plan}
              onClick={() => setAddOn((v) => !v)}
              className={cn(
                "shrink-0 rounded-full px-5 py-2.5 text-xs font-semibold transition-colors",
                !plan
                  ? "cursor-not-allowed bg-ink/5 text-muted"
                  : addOn
                    ? "bg-accent text-white hover:bg-accent-deep"
                    : "border border-ink/15 text-ink hover:border-accent",
              )}
            >
              {!plan ? "Not yet" : addOn ? "Added" : `Add ${formatCurrency(addOnPrice(plan.months))}`}
            </button>
          </div>
        </div>
      </div>

      {plan && (
        <div className="mt-8 rounded-2xl border border-ink/10 bg-paper p-6">
          <p className="mb-1 text-sm font-semibold text-ink">Which studio is your home?</p>
          <p className="mb-4 text-xs text-muted">
            Your plan covers this studio for the whole {plan.months} months. You can&rsquo;t change it
            later without asking us.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {locations.map((l) => (
              <LocationOption key={l.id} loc={l} selected={l.id === locId} onSelect={() => setLocId(l.id)} />
            ))}
          </div>
        </div>
      )}

      <PayloadPanel payload={payload} />

      {/* Sticky total bar */}
      {plan && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-paper/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {plan.name}
                {addOn && " + Cross-Location Add-On"}
              </p>
              <p className="text-xs text-muted">
                {loc ? `Home studio: ${loc.name}` : "Pick your home studio to continue"}
              </p>
            </div>
            <p className="text-lg font-bold text-ink">{formatCurrency(total)}</p>
            <button
              type="button"
              disabled={!ready}
              onClick={() =>
                setPayload({
                  package_kind: "class",
                  package_id: plan.id,
                  location_id: loc!.id,
                  cross_location_add_on: addOn,
                })
              }
              className={cn(
                "rounded-full px-6 py-3 text-sm font-semibold transition-colors",
                ready ? "bg-ink text-paper hover:bg-ink/90" : "cursor-not-allowed bg-ink/15 text-muted",
              )}
            >
              Pay with Stripe
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Variant B — Review page ──────────────────────────────────────────────────
// The catalogue keeps today's one-click Purchase. Every decision moves to a
// dedicated review step — the page /checkout already has, currently unreachable.

function VariantB({ plans, locations }: { plans: Plan[]; locations: Loc[] }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [locId, setLocId] = useState<string | null>(null);
  const [addOn, setAddOn] = useState(false);
  const [promo, setPromo] = useState("");
  const [payload, setPayload] = useState<object | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const loc = locations.find((l) => l.id === locId) ?? null;

  if (!plan) {
    return (
      <div>
        <Heading title="Unlimited Access" note="Catalogue untouched — one tap goes to review." />
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-col rounded-2xl border border-ink/10 bg-paper p-8">
              <p className="text-4xl font-extrabold text-ink">{p.months} months</p>
              <p className="mt-0.5 text-base font-medium text-ink">{p.name}</p>
              <p className="mt-4 text-2xl font-bold text-ink">{formatCurrency(p.price)}</p>
              <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
                <li>Unlimited classes for {p.months} months</li>
                <li>All group classes included</li>
                <li>Covers one studio — you choose which</li>
              </ul>
              <button
                type="button"
                onClick={() => setPlanId(p.id)}
                className="mt-6 w-full rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/90"
              >
                Purchase
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const addOnCost = addOn ? addOnPrice(plan.months) : 0;
  const subtotal = plan.price + addOnCost;
  const discount = promo.trim().toUpperCase() === "SADHANA20" ? 50 : 0;
  const total = subtotal - discount;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <button
        type="button"
        onClick={() => { setPlanId(null); setPayload(null); }}
        className="text-xs text-muted underline hover:text-ink"
      >
        ← Back to plans
      </button>

      <div className="rounded-2xl border border-ink/10 bg-paper p-6">
        <p className="mb-4 text-xs uppercase tracking-wider text-muted">Order summary</p>
        <div className="flex items-start gap-3 border-b border-ink/5 pb-4">
          <div className="h-12 w-12 shrink-0 rounded-lg bg-warm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{plan.name}</p>
            <p className="mt-0.5 text-xs text-muted">Unlimited classes · {plan.months} months</p>
          </div>
          <p className="shrink-0 text-sm font-semibold">{formatCurrency(plan.price)}</p>
        </div>

        {/* Step 1: home studio — the one thing that can't be undone. */}
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink">Choose your home studio</p>
          <p className="mb-3 mt-0.5 text-xs text-muted">
            This plan covers one studio for {plan.months} months. Pick the one you&rsquo;ll practise at
            most.
          </p>
          <div className="space-y-2.5">
            {locations.map((l) => (
              <LocationOption key={l.id} loc={l} selected={l.id === locId} onSelect={() => setLocId(l.id)} size="large" />
            ))}
          </div>
        </div>

        {/* Step 2: the upsell, greyed until a studio exists to extend from. */}
        <div
          className={cn(
            "mt-5 rounded-xl border p-4 transition-colors",
            !loc ? "border-dashed border-ink/15 bg-warm/50" : addOn ? "border-accent bg-accent/5" : "border-ink/10",
          )}
        >
          <div className="flex items-start gap-3">
            <input
              id="addon"
              type="checkbox"
              disabled={!loc}
              checked={addOn}
              onChange={(e) => setAddOn(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent,#8a9a5b)] disabled:opacity-40"
            />
            <label htmlFor="addon" className={cn("min-w-0 flex-1", loc ? "cursor-pointer" : "cursor-not-allowed")}>
              <span className={cn("block text-sm font-semibold", loc ? "text-ink" : "text-muted")}>
                Add the other studio too — {formatCurrency(addOnPrice(plan.months))}
              </span>
              {loc ? (
                <>
                  <span className="mt-1 block text-sm text-muted">
                    Practise at {locations.find((l) => l.id !== loc.id)?.name} as well as {loc.name},
                    for as long as this plan runs.
                  </span>
                  <AddOnMaths months={plan.months} className="mt-2" />
                </>
              ) : (
                <span className="mt-1 block text-xs text-muted">
                  Pick your home studio first — we need to know which one to extend from.
                </span>
              )}
            </label>
          </div>
        </div>

        {/* Promo */}
        <div className="mt-5 flex gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
              placeholder="Promo code"
              className="w-full rounded-xl border border-ink/10 bg-paper py-3 pl-9 pr-4 text-sm uppercase focus:border-accent focus:outline-none"
            />
          </div>
          <button type="button" className="rounded-xl border border-ink/10 px-4 py-3 text-sm font-medium hover:border-accent">
            Apply
          </button>
        </div>

        {/* Breakdown */}
        <div className="mt-5 space-y-1 border-t border-ink/10 pt-4 text-sm">
          <Row label={plan.name} value={formatCurrency(plan.price)} />
          {addOn && <Row label={`Cross-Location Add-On (${plan.months} × ${formatCurrency(RATE_SGD)})`} value={formatCurrency(addOnCost)} />}
          {discount > 0 && <Row label="Promo (SADHANA20)" value={`−${formatCurrency(discount)}`} accent />}
          <Row label="Includes GST (9%)" value={formatCurrency(total - Math.round((total / 1.09) * 100) / 100)} muted />
          <div className="mt-2 flex justify-between border-t border-ink/10 pt-2 text-base font-bold text-ink">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      {loc && <HomeLocationConfirm loc={loc} plan={plan} />}

      <button
        type="button"
        disabled={!loc}
        onClick={() =>
          setPayload({
            package_kind: "class",
            package_id: plan.id,
            location_id: loc!.id,
            cross_location_add_on: addOn,
            promo_code: promo.trim() || undefined,
          })
        }
        className={cn(
          "w-full rounded-full py-4 text-sm font-semibold transition-colors",
          loc ? "bg-ink text-paper hover:bg-ink/90" : "cursor-not-allowed bg-ink/15 text-muted",
        )}
      >
        {loc ? `Pay ${formatCurrency(total)} with Stripe` : "Choose your home studio to continue"}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Lock className="h-3 w-3" /> Secured by Stripe · All prices in SGD
      </p>

      <PayloadPanel payload={payload} />
    </div>
  );
}

function Row({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div className={cn("flex justify-between py-1.5", muted && "text-muted", accent && "text-accent-deep")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── Variant C — Stepped modal ────────────────────────────────────────────────
// Purchase opens a modal that refuses to be skipped: one screen for the studio,
// one for the Add-On. Nothing else is on screen while the irreversible choice
// is being made.

function VariantC({ plans, locations }: { plans: Plan[]; locations: Loc[] }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [locId, setLocId] = useState<string | null>(null);
  const [addOn, setAddOn] = useState(false);
  const [payload, setPayload] = useState<object | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const loc = locations.find((l) => l.id === locId) ?? null;
  const other = locations.find((l) => l.id !== locId) ?? null;

  function close() {
    setPlanId(null);
    setStep(1);
    setLocId(null);
    setAddOn(false);
  }

  return (
    <div>
      <Heading title="Unlimited Access" note="Purchase opens a two-step modal. No page load, no way past the studio choice." />

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((p) => (
          <div key={p.id} className="flex flex-col rounded-2xl border border-ink/10 bg-paper p-8">
            <p className="text-4xl font-extrabold text-ink">{p.months} months</p>
            <p className="mt-0.5 text-base font-medium text-ink">{p.name}</p>
            <p className="mt-4 text-2xl font-bold text-ink">{formatCurrency(p.price)}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
              <li>Unlimited classes for {p.months} months</li>
              <li>All group classes included</li>
              <li>Covers one studio — you choose at checkout</li>
            </ul>
            <button
              type="button"
              onClick={() => setPlanId(p.id)}
              className="mt-6 w-full rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink/90"
            >
              Purchase
            </button>
          </div>
        ))}
      </div>

      <PayloadPanel payload={payload} />

      {plan && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-paper p-7 shadow-modal">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted">Step {step} of 2</p>
                <h3 className="mt-1 font-serif text-xl text-ink">
                  {step === 1 ? "Where will you practise?" : "One more thing"}
                </h3>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1 text-muted hover:bg-warm hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>

            {step === 1 ? (
              <>
                <p className="mb-4 text-sm leading-relaxed text-muted">
                  {plan.name} covers <span className="font-medium text-ink">one</span> studio for{" "}
                  {plan.months} months. Choose the one you&rsquo;ll go to most — changing it later means
                  asking us.
                </p>
                <div className="space-y-2.5">
                  {locations.map((l) => (
                    <LocationOption key={l.id} loc={l} selected={l.id === locId} onSelect={() => setLocId(l.id)} size="large" />
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!loc}
                  onClick={() => setStep(2)}
                  className={cn(
                    "mt-6 flex w-full items-center justify-center gap-1.5 rounded-full py-3.5 text-sm font-semibold transition-colors",
                    loc ? "bg-ink text-paper hover:bg-ink/90" : "cursor-not-allowed bg-ink/10 text-muted",
                  )}
                >
                  {loc ? "Continue" : "Pick a studio"} <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
                  <p className="text-sm font-semibold text-ink">
                    Want {other?.name} as well?
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Add both studios to this plan for {formatCurrency(addOnPrice(plan.months))}.
                  </p>
                  <AddOnMaths months={plan.months} className="mt-3" />
                </div>

                <div className="mt-5 space-y-1 text-sm">
                  <Row label={plan.name} value={formatCurrency(plan.price)} />
                  {addOn && (
                    <Row
                      label="Cross-Location Add-On"
                      value={formatCurrency(addOnPrice(plan.months))}
                      accent
                    />
                  )}
                  <div className="mt-2 flex justify-between border-t border-ink/10 pt-2 text-base font-bold text-ink">
                    <span>Total</span>
                    <span>{formatCurrency(plan.price + (addOn ? addOnPrice(plan.months) : 0))}</span>
                  </div>
                </div>

                <div className="mt-3">
                  {loc && <HomeLocationConfirm loc={loc} plan={plan} />}
                </div>

                <div className="mt-5 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAddOn(true);
                      setPayload({ package_kind: "class", package_id: plan.id, location_id: loc!.id, cross_location_add_on: true });
                      close();
                    }}
                    className="w-full rounded-full bg-accent py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-deep"
                  >
                    Add both studios — {formatCurrency(plan.price + addOnPrice(plan.months))}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayload({ package_kind: "class", package_id: plan.id, location_id: loc!.id, cross_location_add_on: false });
                      close();
                    }}
                    className="w-full rounded-full border border-ink/15 py-3 text-sm font-medium text-ink transition-colors hover:bg-warm"
                  >
                    Just {loc?.name} — {formatCurrency(plan.price)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="w-full py-1 text-xs text-muted underline hover:text-ink"
                  >
                    Change studio
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared states (identical under every variant) ────────────────────────────

/** Take 1 — nudge: the block reads as an explanation, the upsell is a quiet link. */
function BlockedClassNudge({ home, other }: { home: string; other: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-5 opacity-90">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Vinyasa Flow · 7:00 PM</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <MapPin className="h-3 w-3" /> {other} · Aisha
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-warm px-4 py-2 text-xs text-muted">
          <Lock className="h-3 w-3" /> Not in your plan
        </span>
      </div>
      <p className="mt-3 border-t border-ink/5 pt-3 text-xs leading-relaxed text-muted">
        Your plan covers <span className="font-medium text-ink">{home}</span> only.{" "}
        <button className="text-accent-deep underline underline-offset-2">
          Add {other} for {formatCurrency(RATE_SGD)}/month
        </button>{" "}
        · or <button className="underline underline-offset-2 hover:text-ink">use 1 credit</button>
      </p>
    </div>
  );
}

/** Take 2 — ad: the upsell is the loudest thing in the row. */
function BlockedClassAd({ home, other }: { home: string; other: string }) {
  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Vinyasa Flow · 7:00 PM</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <MapPin className="h-3 w-3" /> {other} · Aisha
          </p>
          <p className="mt-2 text-xs text-muted">
            Covered at {home}, not {other}.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent-deep">
            Unlock both studios
          </button>
          <button className="rounded-full border border-ink/15 px-5 py-2 text-xs text-ink hover:bg-warm">
            Use 1 credit
          </button>
        </div>
      </div>
    </div>
  );
}

/** Standalone Add-On against a live plan — the ceil case, spelled out. */
function StandaloneAddOn({ home, other }: { home: string; other: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-6">
      <p className="text-sm font-semibold text-ink">Cross-Location Add-On</p>
      <p className="mt-1 text-sm text-muted">
        Extend your Unlimited 6 Months to cover {other} as well as {home}.
      </p>
      <div className="mt-4 rounded-xl bg-warm p-4">
        <AddOnMaths
          months={3.33}
          remainder={{ endsOn: "26 Nov 2026", monthsLeft: 3, daysLeft: 10 }}
        />
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-ink/10 pt-4">
        <span className="text-sm text-muted">Total</span>
        <span className="text-lg font-bold text-ink">{formatCurrency(addOnPrice(3.33))}</span>
      </div>
      <button className="mt-4 w-full rounded-full bg-ink py-3.5 text-sm font-semibold text-paper hover:bg-ink/90">
        Pay {formatCurrency(addOnPrice(3.33))} with Stripe
      </button>
    </div>
  );
}

/** The same product, for someone with no plan to attach it to. */
function AddOnNoPlan() {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-warm/50 p-6">
      <p className="text-sm font-semibold text-muted">Cross-Location Add-On</p>
      <p className="mt-1 text-sm text-muted">
        Practise at both studios on one Unlimited plan — {formatCurrency(RATE_SGD)} for every month of
        the plan.
      </p>
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-ink/10 bg-paper px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <p className="text-xs leading-relaxed text-muted">
          This attaches to an Unlimited plan, and you don&rsquo;t have one yet. Buy a plan and you can
          add it in the same checkout.
        </p>
      </div>
      <button className="mt-4 w-full rounded-full border border-ink/15 py-3 text-sm font-medium text-ink hover:bg-paper">
        See Unlimited plans
      </button>
    </div>
  );
}

function SharedStates({ locations }: { locations: Loc[] }) {
  const home = locations[0]?.name ?? "Breadtalk IHQ";
  const other = locations[1]?.name ?? "Outram Park";
  return (
    <div className="mt-16 border-t border-ink/10 pt-10">
      <p className="mb-1 text-[11px] uppercase tracking-wider text-muted">
        Same under every variant — one design each, not being A/B&rsquo;d
      </p>

      <h3 className="mb-1 mt-8 font-serif text-lg text-ink">The blocked class — nudge or ad?</h3>
      <p className="mb-4 text-sm text-muted">
        Two takes on the same state, side by side. The question is tone, not structure.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Take 1 — nudge</p>
          <BlockedClassNudge home={home} other={other} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Take 2 — ad</p>
          <BlockedClassAd home={home} other={other} />
        </div>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 font-serif text-lg text-ink">Standalone purchase, part month</h3>
          <p className="mb-4 text-sm text-muted">
            An existing holder buying the Add-On alone, 3 months 10 days left. Charged for 4.
          </p>
          <StandaloneAddOn home={home} other={other} />
        </div>
        <div>
          <h3 className="mb-1 font-serif text-lg text-ink">Same product, no plan</h3>
          <p className="mb-4 text-sm text-muted">
            The other disabled reason — nothing to attach to, rather than nothing chosen yet.
          </p>
          <AddOnNoPlan />
        </div>
      </div>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

function PrototypeContent() {
  const searchParams = useSearchParams();
  const variant = searchParams.get("variant") ?? "A";
  const { data } = usePackagesCatalog();
  const { data: locData } = useLocations();

  const plans: Plan[] = useMemo(() => {
    const real = (data?.classPackages ?? [])
      .filter((p) => p.kind === "unlimited")
      .map((p) => ({
        id: p.id,
        name: p.name,
        months: p.duration_days != null ? Math.max(1, Math.round(p.duration_days / 30)) : 6,
        price: parseFloat(p.effective_price_sgd),
      }));
    return real.length ? real : FALLBACK_PLANS;
  }, [data]);

  const locations: Loc[] = locData?.length ? locData : FALLBACK_LOCATIONS;
  const usingStubPlans = plans === FALLBACK_PLANS;

  return (
    <BookingSurface maxWidth="lg" padding="default">
      <div className="mb-8 rounded-xl border border-dashed border-ink/25 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-ink">Prototype — issue #8.</span> Three variants of the
        Unlimited purchase flow. Arrow keys or the bar at the bottom to switch. Nothing is charged;
        Pay prints the payload.
        {usingStubPlans && " Catalogue holds no unlimited plans, so plans below are stubbed."}
      </div>

      {variant === "A" && <VariantA plans={plans} locations={locations} />}
      {variant === "B" && <VariantB plans={plans} locations={locations} />}
      {variant === "C" && <VariantC plans={plans} locations={locations} />}

      <SharedStates locations={locations} />

      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </BookingSurface>
  );
}

export default function PrototypeCheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper px-4 py-12 text-sm text-muted">Loading…</div>}>
      <PrototypeContent />
    </Suspense>
  );
}
