import type { ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import type { Api } from "@/lib/api";
import type { ApiCorporateRequest } from "@/lib/corporate";
import type { BookingSources } from "@/lib/my-bookings";
import { makePtSessionsApi, type RawPtRequest } from "@/lib/pt-sessions";
import { reportError } from "@/lib/report-error";

/**
 * Everything a member holds, as My bookings lists it — and as a day of My
 * activity opens to. Only the class lists are essential: a failed PT,
 * workshop or corporate read must not blank the member's classes, so each
 * of those falls back to none (and is reported).
 */
export async function readBookingSources(api: Api): Promise<BookingSources> {
  const optional = <T,>(p: Promise<T>, fallback: T, scope: string) =>
    p.catch((err) => {
      reportError(err, { scope });
      return fallback;
    });
  const [upcoming, past, cancelled, pt, workshops, corporate] = await Promise.all([
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"),
    api.get<{ bookings: ApiBooking[] }>("/me/bookings/cancelled"),
    optional(makePtSessionsApi(api).listRequests(), { pt_requests: [] as RawPtRequest[] }, "bookings-pt"),
    optional(
      api.get<{ workshop_bookings: ApiWorkshopBooking[] }>("/me/workshop-bookings"),
      { workshop_bookings: [] },
      "bookings-workshops",
    ),
    optional(
      api.get<{ corporate_requests: ApiCorporateRequest[] }>("/me/corporate-requests"),
      { corporate_requests: [] },
      "bookings-corporate",
    ),
  ]);
  return {
    upcoming: upcoming.bookings ?? [],
    past: past.bookings ?? [],
    cancelled: cancelled.bookings ?? [],
    pt: pt.pt_requests ?? [],
    workshops: workshops.workshop_bookings ?? [],
    corporate: corporate.corporate_requests ?? [],
  };
}
