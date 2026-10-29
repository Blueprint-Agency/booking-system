import { redirect } from "next/navigation";
import { repeatWeeklyHref } from "@/lib/repeat-weekly";

/**
 * A weekly series is the class screen with Repeat weekly on; a bookmark or link
 * to this series address lands there with its slot.
 */
export default async function LegacyNewSeriesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  redirect(repeatWeeklyHref(params));
}
