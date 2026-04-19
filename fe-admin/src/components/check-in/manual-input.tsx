"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ManualInput({ onSubmit }: { onSubmit: (id: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Booking ID (e.g. bk_abc123)"
        className="flex-1"
      />
      <Button
        onClick={() => {
          if (!val.trim()) return;
          onSubmit(val.trim());
          setVal("");
        }}
      >
        Check in
      </Button>
    </div>
  );
}
