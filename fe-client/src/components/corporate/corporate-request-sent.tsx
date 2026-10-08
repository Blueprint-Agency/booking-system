"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useBrandCopy } from "@/components/brand/brand-provider";
import { RequestSentCelebration } from "@/components/celebration/request-sent-celebration";
import { BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import { corporateWhatsappHref, WHATSAPP_COPY_KEY, type ApiCorporateRequest } from "@/lib/corporate";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";

/**
 * A corporate package just bought, as "Your bookings" greets it (fe-client-features
 * §6.2): the "Request sent!" celebration (§5.2 step 4) and the studio's WhatsApp
 * button, where the dates, venue and headcount are settled.
 *
 * A paid return carries the provider's session, recorded here at once rather
 * than waiting on webhook delivery (none in local dev), and then the list is
 * re-read so the new pending request is on it. `onSynced` is that re-read.
 */
export function CorporateRequestSent({
  packageId,
  sessionId,
  requests,
  onSynced,
}: {
  packageId: string | null;
  sessionId: string | null;
  /** The member's corporate requests as last read; the package's name comes from them. */
  requests: ApiCorporateRequest[] | null;
  onSynced: () => Promise<void> | void;
}) {
  const api = useApi();
  const phone = useBrandCopy(WHATSAPP_COPY_KEY, "");
  const [celebrating, setCelebrating] = useState(true);
  const synced = useRef(false);

  useEffect(() => {
    if (!sessionId || synced.current) return;
    synced.current = true;
    (async () => {
      try {
        await api.post("/me/checkout/sync-session", { session_id: sessionId });
      } catch (err) {
        // The webhook records the payment and makes the request regardless.
        reportError(err, { scope: "corporate-checkout-sync" });
      }
      await onSynced();
    })();
  }, [api, sessionId, onSynced]);

  const name = requests?.find((r) => r.package.id === packageId)?.package.name ?? "Your corporate package";
  const whatsapp = corporateWhatsappHref(phone, name);

  return (
    <>
      {/* Only when the studio published a number — see `corporateWhatsappHref`. */}
      {whatsapp && (
        <div className={cn(CARD, "mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5")}>
          <div>
            <p className="font-semibold text-ink">Plan it with us on WhatsApp</p>
            <p className="text-sm text-muted">Tell us your dates, venue and group size.</p>
          </div>
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(BTN_SECONDARY, "min-h-[44px] shrink-0")}
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp us
          </a>
        </div>
      )}

      {celebrating && (
        <RequestSentCelebration
          kind="corporate"
          name={name}
          detail={null}
          place={null}
          person={null}
          onClose={() => setCelebrating(false)}
        />
      )}
    </>
  );
}
