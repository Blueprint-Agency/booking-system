import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { signedInRedirectPath } from "@/lib/auth-redirect";

const isProtected = createRouteMatcher(["/account(.*)", "/checkout"]);

export default clerkMiddleware(async (auth, req) => {
  // A signed-in user has no business on /login or /register — send them where
  // they were headed. Rendering the form leads to Clerk's `session_exists`
  // ("You're already signed in") error on submit.
  const authedTarget = signedInRedirectPath(req.nextUrl);
  if (authedTarget) {
    const { userId } = await auth();
    if (userId) return NextResponse.redirect(new URL(authedTarget, req.url));
    return;
  }

  if (isProtected(req)) {
    const { userId } = await auth();
    if (!userId) {
      const signIn = new URL("/login", req.url);
      signIn.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(signIn);
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
