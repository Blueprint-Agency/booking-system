import { Badge } from "@/components/ui";
import { receiptStatusLabel, type ReceiptStatus } from "@/lib/receipts";

/** Issued, or Refunded once a Refund has landed on the Receipt's Purchase. */
export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return <Badge tone={status === "refunded" ? "warning" : "sage"}>{receiptStatusLabel(status)}</Badge>;
}
