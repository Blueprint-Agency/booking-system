"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, Calendar, ChevronLeft, MapPin, CalendarX } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { BuyButton } from "@/components/checkout/buy-button";
import { cn } from "@/lib/utils";
import {
  type ApiWorkshopTier,
  formatSgd,
  formatDayRange,
  tierEffectivePrice,
  useWorkshop,
} from "@/lib/workshops";

function formatDayChip(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const date = s.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = `${s.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} – ${e.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
  return `${date} · ${time}`;
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
      <div
        className="max-w-5xl mx-auto px-4 sm:px-6 py-6 md:py-12 grid gap-8 lg:grid-cols-[1fr_360px]"
        aria-busy="true"
        aria-label="Loading workshop"
      >
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        </div>
        <Skeleton className="hidden lg:block h-72 rounded-2xl" />
      </div>
    );
  }

  if (error || !workshop) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <EmptyState
          icon={CalendarX}
          title="Workshop not found"
          description="This workshop doesn't exist or has been removed."
          cta={{ href: "/workshops", label: "Back to workshops" }}
        />
      </div>
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

  return (
    <>
      <div id="purchase">
        <BookingSurface maxWidth="lg" flush>
          <Link
            href="/workshops"
            className="-ml-1 mb-4 inline-flex min-h-[40px] items-center gap-1 rounded-full pl-1 pr-3 text-sm font-medium text-muted hover:text-ink transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            All workshops
          </Link>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 lg:gap-10">
            {/* Left column */}
            <div className="min-w-0">
              <SectionHeading
                eyebrow="Workshop"
                title={workshop.name}
              />

              {/* Date & place first — they decide whether the rest is worth reading. */}
              <div className="-mt-2 mb-6 space-y-1.5">
                <div className="text-sm text-ink flex items-start gap-2">
                  <Calendar size={15} className="mt-0.5 shrink-0 text-accent-deep" />
                  <span>
                    {formatDayRange(workshop.starts_at, workshop.ends_at)}
                  </span>
                </div>
                {workshop.location && (
                  <div className="text-sm text-muted flex items-start gap-2">
                    <MapPin size={15} className="mt-0.5 shrink-0 text-ink/40" />
                    <span>
                      {workshop.location.name}
                      {workshop.location.address
                        ? ` · ${workshop.location.address}`
                        : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Below lg the purchase card sits after the whole description,
                  so the price and a way to it come up front. */}
              {sortedTiers.length > 0 && (
                <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-ink/5 bg-card p-4 shadow-soft lg:hidden">
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-ink">{fromPrice ?? "—"}</p>
                    {sortedTiers.length > 1 && (
                      <p className="text-xs text-muted">
                        {sortedTiers.length} options to choose from
                      </p>
                    )}
                  </div>
                  <a
                    href="#book"
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-medium text-paper hover:bg-ink/90 transition-colors"
                  >
                    {sortedTiers.length > 1 ? "Choose and book" : "Book"}
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              )}

              {workshop.cover_url && (
                <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden mb-6">
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

              {/* Instructors */}
              {mainInstructor && (
                <div className="border-t border-ink/10 pt-8 mt-10 space-y-6">
                  {/* Main instructor — prominent */}
                  <div className="flex gap-4 items-start">
                    {mainInstructor.avatar_url ? (
                      <div className="relative h-14 w-14 shrink-0 rounded-full overflow-hidden">
                        <Image
                          src={mainInstructor.avatar_url}
                          alt={mainInstructor.name}
                          fill
                          className="object-cover"
                          sizes="56px"
                        />
                      </div>
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-full bg-ink/10 flex items-center justify-center text-ink font-bold text-lg">
                        {mainInstructor.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {mainInstructor.name}
                      </p>
                      {supportingInstructors.length > 0 && (
                        <p className="text-xs text-muted mt-0.5 truncate">
                          with{" "}
                          {supportingInstructors
                            .map((i) => i.name)
                            .join(" & ")}
                        </p>
                      )}
                      {mainInstructor.bio && (
                        <p className="text-sm text-ink/70 mt-2 leading-relaxed">
                          {mainInstructor.bio}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Supporting instructors — quieter, smaller avatars */}
                  {supportingInstructors.map((instructor) => (
                    <div key={instructor.id} className="flex gap-4 items-start pl-4">
                      {instructor.avatar_url ? (
                        <div className="relative h-10 w-10 shrink-0 rounded-full overflow-hidden">
                          <Image
                            src={instructor.avatar_url}
                            alt={instructor.name}
                            fill
                            className="object-cover"
                            sizes="40px"
                          />
                        </div>
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-full bg-ink/10 flex items-center justify-center text-ink font-semibold text-sm">
                          {instructor.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-ink">
                          {instructor.name}
                        </p>
                        {instructor.bio && (
                          <p className="text-xs text-ink/70 mt-1 leading-relaxed">
                            {instructor.bio}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* All days */}
              {sortedDays.length > 1 && (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-ink mb-3">
                    Sessions
                  </h3>
                  <ul className="space-y-2">
                    {sortedDays.map((d) => (
                      <li
                        key={d.id}
                        className="rounded-xl border border-ink/10 bg-card px-4 py-3 text-sm"
                      >
                        <p className="font-medium text-ink">
                          Day {d.ord}
                        </p>
                        <p className="text-muted">
                          {formatDayChip(d.starts_at, d.ends_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right column — sticky purchase card */}
            <div
              id="book"
              className="scroll-mt-20 lg:sticky lg:top-24 self-start w-full rounded-2xl border border-ink/5 bg-card shadow-soft p-5 sm:p-6 space-y-4"
            >
              {sortedTiers.length === 0 ? (
                <p className="text-sm text-muted">
                  Pricing is being finalised. Check back soon.
                </p>
              ) : (
                <>
                  <div>
                    <p className="text-3xl font-extrabold text-ink flex items-baseline gap-2">
                      {priceForSelected
                        ? formatSgd(priceForSelected.amount)
                        : "—"}
                      {priceForSelected?.hasStrike && (
                        <span className="text-sm font-medium text-muted line-through">
                          {formatSgd(priceForSelected.strikeFrom)}
                        </span>
                      )}
                    </p>
                    {priceForSelected?.isEarlyBird && selectedTier?.early_bird_cutoff_at && (
                      <p className="text-xs uppercase tracking-wider text-accent-deep mt-1">
                        Early bird · until{" "}
                        {new Date(
                          selectedTier.early_bird_cutoff_at,
                        ).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    )}
                  </div>

                  {sortedTiers.length > 1 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-ink">
                        Choose an option
                      </p>
                      <div className="space-y-2">
                        {sortedTiers.map((t) => {
                          const isActive = (selectedTier?.id ?? null) === t.id;
                          const eff = tierEffectivePrice(t);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setSelectedTierId(t.id)}
                              aria-pressed={isActive}
                              className={cn(
                                "w-full text-left rounded-xl border px-4 py-3 transition-colors",
                                isActive
                                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                                  : "border-ink/10 hover:border-ink/20",
                              )}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-sm font-semibold text-ink">
                                  {t.name}
                                </p>
                                <p className="text-sm font-bold text-ink">
                                  {formatSgd(eff.amount)}
                                </p>
                              </div>
                              {t.description && (
                                <p className="text-xs text-muted mt-1">
                                  {t.description}
                                </p>
                              )}
                              <p className="text-xs text-muted mt-1">
                                {t.day_ids.length}{" "}
                                {t.day_ids.length === 1 ? "day" : "days"} included
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedTier && tierDays.length > 0 && sortedTiers.length === 1 && (
                    <p className="text-xs text-muted">
                      Includes {tierDays.length}{" "}
                      {tierDays.length === 1 ? "session" : "sessions"}.
                    </p>
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
                    className="block rounded-full bg-ink text-paper w-full min-h-[48px] py-3 text-sm font-medium mt-1 hover:bg-ink/90 transition-colors text-center"
                    loadingLabel="Redirecting…"
                  >
                    Purchase Now
                  </BuyButton>
                  {/* A paid tier goes to our review page first, not straight to
                      the payment provider; a free one is booked on the spot. */}
                  {!(Number(priceForSelected?.amount) <= 0) && (
                    <p className="text-xs text-muted text-center">
                      Review your booking before paying
                    </p>
                  )}
                  <p className="text-xs text-muted text-center">
                    Workshop bookings can&apos;t be cancelled in the app. For any
                    change, contact the studio.
                  </p>
                </>
              )}
            </div>
          </div>
        </BookingSurface>
      </div>
    </>
  );
}
