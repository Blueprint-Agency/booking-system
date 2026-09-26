import { redirect } from "next/navigation";
import { repeatWeeklyHref } from "@/lib/repeat-weekly";

/**
 * The retired series screen. A weekly series is now the class screen with
 * Repeat weekly on; bookmarks and old links land there with their slot.
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
