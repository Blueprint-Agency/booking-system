import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ApiOwnLeaveRequest } from "@/lib/leave";

/** Open the Supporting Document, or pick one to attach when there is none yet. */
export function DocumentButton({
  request,
  className,
  onOpen,
  onAttach,
}: {
  request: ApiOwnLeaveRequest;
  className?: string;
  onOpen: () => void;
  onAttach: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("flex items-center gap-1 text-xs text-accent hover:underline", className)}
      onClick={request.has_supporting_document ? onOpen : onAttach}
    >
      <Paperclip className="h-3 w-3" />
      {request.has_supporting_document ? "Document" : "Attach document"}
    </button>
  );
}

/** Withdraw a pending request, or cancel approved leave that hasn't started. */
export function TransitionButton({
  request,
  busy,
  className,
  onClick,
}: {
  request: ApiOwnLeaveRequest;
  busy: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" disabled={busy} className={className} onClick={onClick}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : request.status === "pending" ? (
        "Withdraw"
      ) : (
        "Cancel"
      )}
    </Button>
  );
}
