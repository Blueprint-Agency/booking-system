"use client";

import { useState } from "react";
import { signOutMember } from "@/lib/member-auth";

/**
 * The banner's Stop button. Signs the impersonation session out against the
 * backend first — that revokes it, so a sibling tab still showing the member is
 * refused on its next request, and the backend logs the end (#118) — then posts
 * to `/stop-impersonating`, which clears the grant cookie and closes the tab.
 *
 * The form still posts if the sign-out fails: `signOutMember` forgets the token
 * in this browser whatever the backend said, and the session expires with the
 * grant within the hour.
 */
export function StopImpersonatingButton() {
  const [stopping, setStopping] = useState(false);

  async function stop(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stopping) return;
    setStopping(true);
    const form = event.currentTarget;
    try {
      await signOutMember();
    } finally {
      form.submit();
    }
  }

  return (
    <form action="/stop-impersonating" method="post" className="shrink-0" onSubmit={stop}>
      <button
        type="submit"
        disabled={stopping}
        className="whitespace-nowrap rounded-full border border-ink/30 px-3 py-1 text-xs font-semibold text-ink hover:bg-ink/10 transition-colors disabled:opacity-60"
      >
        Stop
        <span className="hidden sm:inline"> impersonating</span>
      </button>
    </form>
  );
}
