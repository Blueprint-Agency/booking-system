"use client";

import { CelebrationDetails, CelebrationSheet, usePickedLine } from "@/components/celebration/celebration-sheet";

/** A light line while they wait; each says how the studio will reach them. */
const LINES = {
  pt: [
    "Request's in! The studio will message you on WhatsApp to lock in a time. Keep your phone close and your hamstrings closer.",
    "Sent! We'll confirm a time on WhatsApp. Waiting patiently counts as mindfulness practice, we checked.",
    "Your request is on its way. We'll be in touch on WhatsApp — no need to refresh every thirty seconds (but we get it).",
  ],
  corporate: [
    "Request sent! We'll be in touch on WhatsApp to plan it with you. Your team's shoulders are already relaxing.",
    "Your team session is in the works. We'll reach out on WhatsApp — start practising your \"everyone, grab a mat\" voice.",
  ],
} as const;

/**
 * A PT or Corporate Request just sent (fe-client-features §5.2, §6.2). Nothing
 * is booked yet, so there is no calendar to offer: that comes with the
 * "Approved!" celebration once the studio schedules it.
 */
export function RequestSentCelebration({
  kind,
  name,
  detail,
  place,
  person,
  onClose,
}: {
  kind: "pt" | "corporate";
  /** What was asked for. */
  name: string;
  /** A line under it: the session type and times proposed, or the package. */
  detail: string | null;
  place: string | null;
  person: string | null;
  onClose: () => void;
}) {
  const line = usePickedLine(LINES[kind]);
  return (
    <CelebrationSheet
      id={`request-sent-${kind}`}
      title="Request sent!"
      line={line}
      event={null}
      onClose={onClose}
      testId="request-sent-celebration"
    >
      <CelebrationDetails name={name} when={detail} place={place} person={person} />
    </CelebrationSheet>
  );
}
