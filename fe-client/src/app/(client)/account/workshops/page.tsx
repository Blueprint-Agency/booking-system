import { redirect } from "next/navigation";

/** Workshops are one filter of "Your bookings"; an old link lands on it. */
export default function AccountWorkshopsPage() {
  redirect("/account?type=workshop");
}
