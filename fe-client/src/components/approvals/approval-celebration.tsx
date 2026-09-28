"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useBrand } from "@/components/brand/brand-provider";
import {
  CelebrationDetails,
  CelebrationSheet,
  accountLink,
  calendarUid,
  usePickedLine,
} from "@/components/celebration/celebration-sheet";
import { useApi } from "@/lib/api";
import { useMemberSession } from "@/lib/member-auth";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { approvalAccountPath, approvalEvent, approvalName, type ApiApproval } from "@/lib/approvals";

/** How often the app looks again while the member has it open and in view. */
const POLL_MS = 60_000;

const LINES = {
  pt: [
    "It's official — the studio said yes! The only thing left to schedule is your memory. Your calendar can take it from here.",
    "Approved! Your private session is locked in. Put it in your calendar before your brain files it under \"someday\".",
    "Your instructor is ready for you. Are your hamstrings? Either way, add it to your calendar.",
  ],
  corporate: [
    "Approved! Your team session is on. Add it to the calendar so nobody books a meeting over it.",
    "It's happening — your team session is scheduled. Pop it in the calendar and let the stretching begin.",
  ],
} as const;

/**
 * Watches for the member's PT and Corporate Requests the studio has approved
 * (scheduled) and celebrates each once (fe-client-features §11.2): read on
 * every page, when the tab comes back into view, and every minute while it is
 * visible — so a member online at the moment of approval sees it within a
 * minute, and one who was away sees it on their next visit, on any device.
 * Mounted once, in the member layout; renders nothing while there is nothing new.
 */
export function ApprovalWatcher() {
  const api = useApi();
  const { isLoaded, isSignedIn } = useMemberSession();
  const pathname = usePathname();
  const [queue, setQueue] = useState<ApiApproval[]>([]);
  // Seen in this tab already: not shown again while the seen mark is in flight,
  // nor if it failed (it will be offered again on the next visit).
  const dismissed = useRef(new Set<string>());
  const inFlight = useRef(false);
  const active = isLoaded && isSignedIn === true;
  const activeRef = useRef(active);
  activeRef.current = active;

  const check = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const res = await api.get<{ approvals: ApiApproval[] }>("/me/approvals");
      // Signed out while the read was out: these were the last member's.
      if (!activeRef.current) return;
      setQueue(res.approvals.filter((a) => !dismissed.current.has(`${a.kind}:${a.id}`)));
    } catch {
      // A missed look is harmless: the next one finds the same approvals.
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  // Every page the member opens.
  useEffect(() => {
    if (active) void check();
  }, [active, pathname, check]);

  // Every minute while in view, and as soon as the tab comes back.
  useEffect(() => {
    if (!active) {
      setQueue([]);
      return;
    }
    const timer = setInterval(() => void check(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, check]);

  const current = queue[0];
  if (!current) return null;

  const close = () => {
    dismissed.current.add(`${current.kind}:${current.id}`);
    setQueue((q) => q.slice(1));
    api.post(`/me/approvals/${current.kind}/${current.id}/seen`).catch(() => {
      // Left unseen on the server: it is celebrated again on the next visit.
    });
  };

  return <ApprovalCelebration key={`${current.kind}:${current.id}`} approval={current} onClose={close} />;
}

function ApprovalCelebration({ approval, onClose }: { approval: ApiApproval; onClose: () => void }) {
  const brand = useBrand();
  const line = usePickedLine(LINES[approval.kind]);
  const event = useMemo(
    () =>
      approvalEvent(approval, brand.name, {
        uid: calendarUid(`${approval.kind}-request-${approval.id}`),
        accountUrl: accountLink(approvalAccountPath(approval.kind)),
      }),
    [approval, brand.name],
  );
  return (
    <CelebrationSheet
      id={`approved-${approval.id}`}
      title="Approved!"
      line={line}
      event={event}
      onClose={onClose}
      testId="approval-celebration"
    >
      <CelebrationDetails
        name={approvalName(approval)}
        when={`${formatDate(approval.starts_at)} · ${formatClassTime(approval.starts_at)} – ${formatClassTime(approval.ends_at)}`}
        place={approval.location_name}
        person={approval.instructor_name}
      />
    </CelebrationSheet>
  );
}
