"use client";
import { useRef } from "react";
import { Bell } from "lucide-react";
import { bellLabel, bubbleText } from "@/lib/attention";
import { useAttention } from "./attention-provider";
import { AttentionPanel } from "./attention-panel";

/**
 * The bell in the top bar, at every width: a red bubble with the number of
 * things that need this person (hidden at 0, "99+" past 99), and the panel it
 * opens. The count is also its accessible name, so it is not visual-only.
 */
export function AttentionBell() {
  const { total, panelOpen, setPanelOpen } = useAttention();
  const button = useRef<HTMLButtonElement>(null);
  const text = bubbleText(total);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={bellLabel(total)}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        data-testid="attention-bell"
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {text && (
          <span
            data-testid="attention-bubble"
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[11px] font-semibold leading-[18px] tabular-nums text-white ring-2 ring-card"
          >
            {text}
          </span>
        )}
      </button>
      {panelOpen && <AttentionPanel onClose={() => setPanelOpen(false)} returnFocusTo={button} />}
    </>
  );
}
