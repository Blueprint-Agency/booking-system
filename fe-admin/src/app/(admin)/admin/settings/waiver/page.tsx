"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { Button, Textarea, Label } from "@/components/ui";
import { updateWaiver } from "@/lib/mutations/settings";

export default function WaiverSettingsPage() {
  const waiverText = useAdminState((s) => s.studio.waiverText);
  const [text, setText] = useState(waiverText);

  const save = () => {
    updateWaiver(text);
    toast.success("Waiver updated");
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <Label>Waiver text (markdown supported)</Label>
        <Textarea rows={20} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
        <Button type="button" onClick={save}>
          Save waiver
        </Button>
      </div>
      <div>
        <Label>Preview</Label>
        <article className="prose prose-sm max-w-none rounded-md border border-border bg-paper/40 p-4">
          {text.split("\n").map((line, i) => (
            <p key={i} className="text-sm text-ink">
              {line || " "}
            </p>
          ))}
        </article>
      </div>
    </div>
  );
}
