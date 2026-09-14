// fe-client/src/app/stop-impersonating/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { IMPERSONATION_GRANT_COOKIE } from "@/lib/impersonation-handoff";

/**
 * The last step of stopping an impersonation: clears the grant cookie and
 * closes the tab. The session itself is already gone — the banner's Stop button
 * signs it out against the backend before posting here (#118), because the
 * token lives in this page's storage, where a server route cannot reach it.
 *
 * We can't reliably window.close() from a server response — return a tiny HTML
 * that tries close() and falls back to about:blank so the tab is visually clean.
 */
export async function POST() {
  const jar = await cookies();
  jar.set(IMPERSONATION_GRANT_COOKIE, "", { maxAge: 0, path: "/" });

  const html = `<!doctype html><html><body><script>
    try { window.close(); } catch (e) {}
    setTimeout(function () { location.replace('about:blank'); }, 50);
  </script>Closing…</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
