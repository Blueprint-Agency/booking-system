import { redirect } from "next/navigation";

/** Corporate requests are one filter of "Your bookings"; an old link lands on it. */
export default function AccountCorporatePage() {
  redirect("/account/bookings?type=corporate");
}
