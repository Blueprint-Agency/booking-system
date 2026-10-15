"use client";

/**
 * One Receipt — `GET /me/receipts/:id` (#384). The Receipt itself is the
 * `html` the backend draws, the one design the PDF, the confirmation email and
 * the studio portal show too; this page frames it and offers the PDF. Nothing
 * is worked out or laid out here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { ReceiptDocument } from "@/components/receipts/receipt-document";
import { ContentLoading } from "@/components/ui/content-loading";
import { BTN_SECONDARY } from "@/components/ui/styles";
import { apiErrorCode, useApi } from "@/lib/api";
import { receiptPdfFilename, type Receipt } from "@/lib/receipts";

/** Hand the browser a file to save, as a link to it would. */
function saveFile(file: Blob, filename: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // After the click has handed the file over; revoking at once can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AccountReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [failure, setFailure] = useState<"missing" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  // The PDF is behind the member's session, so it is fetched with it rather than linked to.
  async function downloadPdf(of: Receipt) {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      saveFile(await api.file(`/me/receipts/${of.id}/pdf`), receiptPdfFilename(of.number));
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .get<Receipt>(`/me/receipts/${id}`)
      .then((res) => !cancelled && setReceipt(res))
      .catch((err) => !cancelled && setFailure(apiErrorCode(err) === "receipt_not_found" ? "missing" : "error"));
    return () => {
      cancelled = true;
    };
    // The api client is rebuilt on every render; the fetch follows the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="max-w-2xl">
      <Link
        href="/account/receipts"
        className="-ml-1 mb-2 inline-flex min-h-[36px] items-center gap-0.5 rounded-full pr-2 text-sm font-semibold text-accent-deep hover:text-accent"
      >
        <ChevronLeft className="h-4 w-4" />
        Receipts
      </Link>

      {!receipt && !failure && <ContentLoading label="Loading receipt" />}

      {failure && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          {failure === "missing"
            ? "We couldn't find that receipt on your account."
            : "We couldn't load this receipt right now. Please refresh in a moment."}
        </div>
      )}

      {receipt && (
        <>
          <h1 className="sr-only">Receipt {receipt.number}</h1>
          <ReceiptDocument html={receipt.html} title={`Receipt ${receipt.number}`} />
          <div className="mt-4 flex flex-col items-start gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={downloading} onClick={() => downloadPdf(receipt)}>
              <Download className="h-4 w-4" aria-hidden />
              {downloading ? "Preparing PDF…" : "Download PDF"}
            </button>
            {downloadFailed && (
              <p role="alert" className="text-sm text-error">
                We couldn&apos;t download this receipt right now. Please try again in a moment.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
