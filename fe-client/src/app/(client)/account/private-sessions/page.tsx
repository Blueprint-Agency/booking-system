import { redirect } from "next/navigation";

/** PT sessions and requests are one filter of "Your bookings"; an old link lands on it. */
export default async function AccountPrivateSessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { submitted } = await searchParams;
  redirect(`/account/bookings?type=pt${submitted === "1" ? "&submitted=pt" : ""}`);
}
