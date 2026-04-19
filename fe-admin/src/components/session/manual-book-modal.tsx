"use client";

import { useMemo, useState } from "react";
import type { Client } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { manualBook } from "@/lib/mock-state";

export function ManualBookModal({
  sessionId,
  clients,
  open,
  onClose,
}: {
  sessionId: string;
  clients: Client[];
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients.slice(0, 20);
    return clients
      .filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(t) ||
          c.email.toLowerCase().includes(t),
      )
      .slice(0, 20);
  }, [q, clients]);

  const submit = () => {
    if (!selected) return;
    manualBook(sessionId, selected);
    setSelected(null);
    setQ("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Manual book">
      <Label htmlFor="mb-search">Search client</Label>
      <Input
        id="mb-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Name or email"
      />
      <div className="mt-3 max-h-60 overflow-auto rounded-lg border border-ink/10 bg-paper/40">
        {filtered.length === 0 ? (
          <div className="p-4 text-sm text-ink/50">No matches.</div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/5 " +
                (selected === c.id ? "bg-accent/10" : "")
              }
            >
              <div>
                <div className="font-medium text-ink">
                  {c.firstName} {c.lastName}
                </div>
                <div className="text-xs text-ink/50">{c.email}</div>
              </div>
              {selected === c.id && <span className="text-accent text-xs">Selected</span>}
            </button>
          ))
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!selected}>Book</Button>
      </div>
    </Modal>
  );
}
