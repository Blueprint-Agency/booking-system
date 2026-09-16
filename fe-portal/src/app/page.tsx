import { redirect } from "next/navigation";

// Middleware protects this route; authenticated users land here and are
// forwarded into /admin. Unauthenticated users are redirected to /login by
// Clerk's middleware first.
export default function Root() {
  redirect("/admin");
}
