import type { ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import type { Api } from "@/lib/api";
import type { ApiCorporateRequest } from "@/lib/corporate";
import { partitionReads, type BookingKind } from "@/lib/booking-gaps";
import type { BookingSources } from "@/lib/my-bookings";
import { makePtSessionsApi, type RawPtRequest } from "@/lib/pt-sessions";
import { reportError } from "@/lib/report-error";

/**
 * Settle the optional reads of a page that draws a member's bookings, apart
 * from its essential ones: what loaded, and the kinds that did not (#500).
 * Each failure is reported to telemetry under its own `scope`, as it always
 * was; it is not swallowed into an empty list.
 */
export async function settleOptional(
  reads: Partial<Record<BookingKind, { scope: string; read: Promise<unknown> }>>,
): Promise<ReturnType<typeof partitionReads>> {
  const kinds = Object.keys(reads) as BookingKind[];
  const settled = await Promise.allSettled(kinds.map((k) => reads[k]!.read));
  const byKind: Partial<Record<BookingKind, PromiseSettledResult<unknown>>> = {};
  kinds.forEach((kind, i) => {
    const result = settled[i];
    if (result.status === "rejected") reportError(result.reason, { scope: reads[kind]!.scope });
    byKind[kind] = result;
  });
  return partitionReads(byKind);
}

/**
 * Everything a member holds, as My bookings lists it — and as a day of My
 * activity opens to. Only the class lists are essential: a failed PT,
 * workshop or corporate read must not blank the member's classes, so each of
 * those is reported and named in `missing` for the page to say so — never
 * drawn as none.
 */
export async function readBookingSources(
  api: Api,
): Promise<{ sources: BookingSources; missing: BookingKind[] }> {
  const [upcoming, past, cancelled, optional] = await Promise.all([
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"),
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/cancelled"),
    settleOptional({
      pt: { scope: "bookings-pt", read: makePtSessionsApi(api).listRequests() },
      workshops: {
        scope: "bookings-workshops",
        read: api.get<{ workshop_bookings: ApiWorkshopBooking[] }>("/me/workshop-bookings"),
      },
      corporate: {
        scope: "bookings-corporate",
        read: api.get<{ corporate_requests: ApiCorporateRequest[] }>("/me/corporate-requests"),
      },
    }),
  ]);
  const pt = optional.loaded.pt as { pt_requests?: RawPtRequest[] } | undefined;
  const workshops = optional.loaded.workshops as { workshop_bookings?: ApiWorkshopBooking[] } | undefined;
  const corporate = optional.loaded.corporate as { corporate_requests?: ApiCorporateRequest[] } | undefined;
  return {
    sources: {
      upcoming: upcoming.bookings ?? [],
      past: past.bookings ?? [],
      cancelled: cancelled.bookings ?? [],
      pt: pt?.pt_requests ?? [],
      workshops: workshops?.workshop_bookings ?? [],
      corporate: corporate?.corporate_requests ?? [],
    },
    missing: optional.missing,
  };
}
