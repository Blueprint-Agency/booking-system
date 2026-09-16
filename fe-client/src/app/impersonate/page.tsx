"use client";

import { useEffect, useState } from "react";
import { adoptMemberSession } from "@/lib/member-auth";
import { grantCookie, readImpersonationHandoff } from "@/lib/impersonation-handoff";

/**
 * Where a studio admin lands in the member app as the member they impersonate
 * (#118). The portal opens `/impersonate#token=…&grant=…`; this adopts the token
 * as this hostname's member session, keeps the grant, and goes to the account.
 *
 * A full navigation rather than a router push, so the server layout reads the
 * grant cookie and shows the banner from the first account page.
 */
export default function ImpersonatePage() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const handoff = readImpersonationHandoff(window.location.hash);
    // Off the address bar and out of history either way: it held a session token.
    window.history.replaceState(null, "", window.location.pathname);
    if (!handoff) {
      setMissing(true);
      return;
    }
    document.cookie = grantCookie(handoff.grant, window.location.protocol);
    adoptMemberSession(handoff.token);
    window.location.replace("/account");
  }, []);

  if (missing) {
    return (
      <main className="min-h-screen grid place-items-center bg-paper px-4 text-sm text-ink">
        This impersonation link is incomplete. Start again from the portal.
      </main>
    );
  }
  return <main className="min-h-screen bg-paper" aria-busy="true" />;
}
