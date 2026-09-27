import { redirect } from "next/navigation";

/** Classes are one filter of "Your bookings"; an old link lands on it. */
export default async function AccountClassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  const when = tab === "ongoing" || tab === "past" ? `&when=${tab}` : "";
  redirect(`/account/bookings?type=class${when}`);
}
