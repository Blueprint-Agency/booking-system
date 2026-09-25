"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { ArrowDown, CalendarDays, MapPin, CalendarX } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { DateStub } from "@/components/account/date-stub";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { BuyButton } from "@/components/checkout/buy-button";
import { cn } from "@/lib/utils";
import {
  type ApiWorkshopTier,
  formatSgd,
  formatDayRange,
  tierEffectivePrice,
  useWorkshop,
} from "@/lib/workshops";

// Studio time, like the date stub beside it and every other time in the app.
function formatTimeRange(startsAt: string, endsAt: string): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-SG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Singapore",
    });
  return `${t(startsAt)} – ${t(endsAt)}`;
}

export default function WorkshopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: workshop, loading, error } = useWorkshop(id);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  const sortedTiers = useMemo(
    () => [...(workshop?.tiers ?? [])].sort((a, b) => a.ord - b.ord),
    [workshop],
  );

  const selectedTier: ApiWorkshopTier | null = useMemo(() => {
    if (!sortedTiers.length) return null;
    return sortedTiers.find((t) => t.id === selectedTierId) ?? sortedTiers[0]!;
  }, [sortedTiers, selectedTierId]);

  if (loading) {
    return (
      <BookingSurface>
        <ContentLoading label="Loading workshop" />
      </BookingSurface>
    );
  }

  if (error || !workshop) {
    return (
      <BookingSurface maxWidth="md">
        <div className={CARD}>
          <EmptyState
            icon={CalendarX}
            title="Workshop not found"
            description="It may have been removed."
            cta={{ href: "/workshops", label: "All workshops" }}
          />
        </div>
      </BookingSurface>
    );
  }

  const sortedDays = [...workshop.days].sort((a, b) => a.ord - b.ord);
  const dayById = new Map(sortedDays.map((d) => [d.id, d]));
  const tierDays = selectedTier
    ? selectedTier.day_ids
        .map((id) => dayById.get(id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .sort((a, b) => a.ord - b.ord)
    : [];

  const priceForSelected = selectedTier
    ? tierEffectivePrice(selectedTier)
    : null;

  // Split instructors into main vs supporting using `main_instructor_id`.
  // BE returns `instructors` ordered [main, ...supporting]; fall back to that
  // order when `main_instructor_id` is null (e.g. unpublished workshops).
  const mainInstructor =
    workshop.instructors.find((i) => i.id === workshop.main_instructor_id) ??
    workshop.instructors[0] ??
    null;
  const supportingInstructors = workshop.instructors.filter(
    (i) => i.id !== mainInstructor?.id,
  );

  // The cheapest way in, for the summary above the fold on a phone.
  const fromPrice =
    sortedTiers.length > 1
      ? `From ${formatSgd(
          sortedTiers
            .map((t) => Number(tierEffectivePrice(t).amount))
            .reduce((a, b) => Math.min(a, b)),
        )}`
      : priceForSelected
        ? formatSgd(priceForSelected.amount)
        : null;

  const isFree = Number(priceForSelected?.amount) <= 0;

  return (
    <BookingSurface>
      <PageHeader title={workshop.name} back={{ href: "/workshops", label: "Workshops" }} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 lg:gap-10">
        {/* Left column */}
        <div className="min-w-0">
          {/* Date & place first — they decide whether the rest is worth reading. */}
          <div className="-mt-2 mb-5 space-y-1 text-sm">
            <p className="flex items-start gap-2 font-semibold text-ink">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" aria-hidden />
              {formatDayRange(workshop.starts_at, workshop.ends_at)}
            </p>
            {workshop.location && (
              <p className="flex items-start gap-2 text-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" aria-hidden />
                <span>
                  {workshop.location.name}
                  {workshop.location.address ? ` · ${workshop.location.address}` : ""}
                </span>
              </p>
            )}
          </div>

          {/* Below lg the purchase card sits after the whole description,
              so the price and a way to it come up front. */}
          {sortedTiers.length > 0 && (
            <div className={cn(CARD, "mb-6 flex items-center justify-between gap-3 p-4 lg:hidden")}>
              <div className="min-w-0">
                <p className="text-lg font-extrabold text-ink">{fromPrice ?? "—"}</p>
                {sortedTiers.length > 1 && (
                  <p className="text-xs text-muted">{sortedTiers.length} options</p>
                )}
              </div>
              <a href="#book" className={cn(BTN_PRIMARY, "min-h-[44px] shrink-0")}>
                Book
                <ArrowDown className="h-4 w-4" aria-hidden />
              </a>
            </div>
          )}

          {workshop.cover_url && (
            <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-warm">
              <Image
                src={workshop.cover_url}
                alt={workshop.name}
                fill
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover"
              />
            </div>
          )}

          {workshop.description_html && (
            <div
              className="prose text-ink/80 max-w-none space-y-4"
              dangerouslySetInnerHTML={{ __html: workshop.description_html }}
            />
          )}

          {/* All days */}
          {sortedDays.length > 1 && (
            <section className="mt-8" aria-labelledby="sessions-heading">
              <h2 id="sessions-heading" className="mb-3 text-base font-bold text-ink">
                Sessions
              </h2>
              <ul className={cn(CARD, "divide-y divide-ink/5")}>
                {sortedDays.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
                    <DateStub iso={d.starts_at} />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        Day {d.ord}
                        {/* The stub is aria-hidden; the date still has to be read out. */}
                        <span className="sr-only">, {formatDayRange(d.starts_at, null)}</span>
                      </p>
                      <p className="text-sm text-muted">{formatTimeRange(d.starts_at, d.ends_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Instructors */}
          {mainInstructor && (
            <section className="mt-8" aria-labelledby="instructors-heading">
              <h2 id="instructors-heading" className="mb-3 text-base font-bold text-ink">
                {supportingInstructors.length > 0 ? "Instructors" : "Instructor"}
              </h2>
              <div className={cn(CARD, "divide-y divide-ink/5")}>
                {[mainInstructor, ...supportingInstructors].map((instructor, i) => (
                  <div key={instructor.id} className="flex items-start gap-3 sm:gap-4 p-4">
                    {instructor.avatar_url ? (
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full">
                        <Image
                          src={instructor.avatar_url}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div
                        aria-hidden
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/8 font-bold text-accent-deep"
                      >
                        {instructor.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {instructor.name}
                        {i === 0 && supportingInstructors.length > 0 && (
                          <span className="ml-2 text-xs font-semibold text-muted">Lead</span>
                        )}
                      </p>
                      {instructor.bio && (
                        <p className="mt-1 text-sm leading-relaxed text-ink/70">{instructor.bio}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column — sticky purchase card */}
        <div
          id="book"
          className={cn(CARD, "scroll-mt-20 lg:sticky lg:top-24 self-start w-full p-5 sm:p-6 space-y-4")}
        >
          {sortedTiers.length === 0 ? (
            <p className="text-sm text-muted">Pricing isn&apos;t set yet. Check back soon.</p>
          ) : (
            <>
              <div>
                <p className="flex items-baseline gap-2 text-3xl font-extrabold tracking-tight text-ink">
                  {priceForSelected ? formatSgd(priceForSelected.amount) : "—"}
                  {priceForSelected?.hasStrike && (
                    <span className="text-sm font-medium text-muted line-through">
                      {formatSgd(priceForSelected.strikeFrom)}
                    </span>
                  )}
                </p>
                {priceForSelected?.isEarlyBird && selectedTier?.early_bird_cutoff_at && (
                  <p className="mt-1 text-xs font-semibold text-accent-deep">
                    Early bird until{" "}
                    {new Date(selectedTier.early_bird_cutoff_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                )}
                {sortedTiers.length === 1 && tierDays.length > 0 && (
                  <p className="mt-1 text-sm text-muted">
                    {tierDays.length} {tierDays.length === 1 ? "session" : "sessions"}
                  </p>
                )}
              </div>

              {sortedTiers.length > 1 && (
                <div role="radiogroup" aria-label="Options" className="space-y-2">
                  {sortedTiers.map((t) => {
                    const isActive = (selectedTier?.id ?? null) === t.id;
                    const eff = tierEffectivePrice(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setSelectedTierId(t.id)}
                        className={cn(
                          "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                          isActive
                            ? "border-accent bg-accent/5 ring-1 ring-accent"
                            : "border-ink/10 hover:border-ink/25",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">{t.name}</p>
                          <p className="text-sm font-bold text-ink">{formatSgd(eff.amount)}</p>
                        </div>
                        {t.description && <p className="mt-1 text-xs text-muted">{t.description}</p>}
                        <p className="mt-1 text-xs text-muted">
                          {t.day_ids.length} {t.day_ids.length === 1 ? "day" : "days"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              <BuyButton
                target={{
                  kind: "workshop",
                  workshopId: workshop.id,
                  tierId: selectedTier?.id ?? null,
                }}
                context="book a workshop"
                gateHref={`/workshops/${workshop.id}`}
                // NaN, not 0: an absent price must fall to the paid branch.
                // Coercing it to 0 would post-and-grant the workshop for free.
                priceSgd={priceForSelected?.amount ?? NaN}
                className={cn(BTN_PRIMARY, "w-full")}
                loadingLabel="Redirecting…"
              >
                {isFree ? "Book for free" : "Book now"}
              </BuyButton>
              {/* A paid tier goes to our review page first, not straight to
                  the payment provider; a free one is booked on the spot. */}
              <p className="text-xs leading-relaxed text-muted text-center">
                {isFree ? "" : "You'll review your order before paying. "}
                Workshop bookings can&apos;t be cancelled in the app.
              </p>
            </>
          )}
        </div>
      </div>
    </BookingSurface>
  );
}
