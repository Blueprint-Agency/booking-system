// fe-client/src/app/stop-impersonating/route.ts
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Clears the impersonation grant cookie and signs the impersonated client
 * out of the Clerk client session in this browser. We can't reliably
 * window.close() from a server response — return a tiny HTML that tries
 * close() and falls back to about:blank so the tab is visually clean.
 */
export async function POST() {
  const { sessionId } = await auth();
  if (sessionId) {
    // Revoke the current Clerk session so the impersonated identity is gone
    // even if the cookie is somehow restored.
    try {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const c = await clerkClient();
      await c.sessions.revokeSession(sessionId);
    } catch {
      // Best-effort — Clerk client cookies will also be cleared by the SDK
      // on the next /sign-in load.
    }
  }

  const jar = await cookies();
  jar.set("__imp_grant", "", { maxAge: 0, path: "/" });

  // Server-side session revoke alone doesn't update the browser's view of
  // Clerk's cookies — a sibling tab on /account would keep acting as the
  // impersonated client until the SDK's next round-trip. Explicitly clear
  // Clerk's client cookies so impersonation ends immediately in any other
  // open tab on the next page load.
  jar.set("__session", "", { maxAge: 0, path: "/" });
  jar.set("__client_uat", "", { maxAge: 0, path: "/" });

  const html = `<!doctype html><html><body><script>
    try { window.close(); } catch (e) {}
    setTimeout(function () { location.replace('about:blank'); }, 50);
  </script>Closing…</body></html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  return res;
}
