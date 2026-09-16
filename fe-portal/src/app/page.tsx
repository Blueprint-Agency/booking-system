import { redirect } from "next/navigation";

// Everyone is forwarded into /admin, whose workspace sends anyone without a
// staff session on to /login. (The super portal's proxy redirects this path to
// /platform before it gets here.)
export default function Root() {
  redirect("/admin");
}
