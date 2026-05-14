import { redirect } from "next/navigation";

export default function LegacyNewWorkshopRedirect() {
  redirect("/admin/packages/workshops/new");
}
