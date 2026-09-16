"use client";

import { useRef } from "react";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
};

/**
 * Segmented one-time-code input — one box per digit, like Clerk's prebuilt OTP.
 * Auto-advances on type, backspaces to the previous box, supports arrow keys and
 * pasting the full code. Styled to match the portal's inputs.
 */
export function OtpInput({ value, onChange, length = 6, autoFocus }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function commit(next: string[], focusIndex: number) {
    onChange(next.join("").slice(0, length));
    refs.current[Math.max(0, Math.min(focusIndex, length - 1))]?.focus();
  }

  function handleChange(index: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    const next = digits.slice();
    if (!typed) {
      next[index] = "";
      onChange(next.join(""));
      return;
    }
    let i = index;
    for (const ch of typed.split("")) {
      if (i >= length) break;
      next[i] = ch;
      i += 1;
    }
    commit(next, i);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = digits.slice();
      if (next[index]) {
        next[index] = "";
        commit(next, index);
      } else if (index > 0) {
        next[index - 1] = "";
        commit(next, index - 1);
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const next = Array.from({ length }, (_, i) => pasted[i] ?? "");
    commit(next, pasted.length);
  }

  return (
    <div className="flex gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          autoFocus={autoFocus && index === 0}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1}`}
          className="h-12 w-full rounded-lg border border-border bg-paper text-center text-lg font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ))}
    </div>
  );
}
