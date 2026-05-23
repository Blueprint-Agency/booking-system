// fe-client/src/app/__impersonate/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Entry point for a superadmin landing in fe-client as an impersonated client.
 * Reads `ticket` (Clerk one-shot sign-in token) + `grant` (BE-signed JWT)
 * from the URL, sets the grant cookie, and redirects through Clerk's
 * ticket sign-in flow.
 *
 * The Clerk ticket is consumed by Clerk's sign-in page (`<SignIn />`) when
 * it sees `__clerk_ticket` in the URL — no extra server work needed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket");
  const grant = url.searchParams.get("grant");

  if (!ticket || !grant) {
    return new NextResponse("Missing ticket or grant.", { status: 400 });
  }

  // Set the impersonation grant cookie BEFORE the redirect so fe-client and
  // its fetch wrapper see it on the next request.
  const jar = await cookies();
  jar.set("__imp_grant", grant, {
    httpOnly: false, // must be readable by client JS to add to fetch headers
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1h — must match the JWT exp
  });

  // Redirect through the sign-in page so Clerk consumes the ticket. The
  // `redirect_url` is where Clerk lands the user once signed in.
  // fe-client mounts Clerk's <SignIn /> at /login (uses `next` query param
  // for redirect, not `redirect_url`).
  const signInUrl = new URL("/login", url.origin);
  signInUrl.searchParams.set("__clerk_ticket", ticket);
  signInUrl.searchParams.set("redirect_url", "/account");
  signInUrl.searchParams.set("next", "/account");
  return NextResponse.redirect(signInUrl);
}
