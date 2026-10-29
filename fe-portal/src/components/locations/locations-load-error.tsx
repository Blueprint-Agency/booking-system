"use client";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Said in place of the locations when the studio's full list could not be read.
 * Their phone numbers and Maps links are not on screen, so showing the names
 * alone would read as empty fields: nothing is listed to edit until Retry works.
 */
export function LocationsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3"
    >
      <p className="min-w-0 flex-1 text-sm text-error">
        The studio&apos;s locations could not be loaded, archived ones included.
        Nothing can be edited until they are.
      </p>
      <Button size="sm" variant="ghost" onClick={onRetry}>
        <RotateCcw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}
