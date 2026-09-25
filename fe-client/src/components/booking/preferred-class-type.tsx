"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, X } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";

type ClassTypeOption = { id: string; name: string };

/**
 * A private-session request's preferred class type: "Any" by default, or one
 * the member picks from the studio's list. The list opens in an overlay — a
 * bottom sheet on a phone, a centred dialog from `sm` up — rather than a
 * native select. `value` is null for "Any".
 */
export function PreferredClassType({
  classTypes,
  value,
  onChange,
}: {
  classTypes: ClassTypeOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? classTypes.find((c) => c.id === value) ?? null : null;

  const optionClass = (on: boolean) =>
    `min-h-[48px] rounded-xl border px-4 py-3 text-sm font-medium transition ${
      on
        ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
        : "border-ink/10 bg-card text-muted hover:border-accent/40"
    }`;

  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1.5">Preferred class type</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Preferred class type">
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={optionClass(value === null)}
        >
          Any
        </button>
        <button
          type="button"
          aria-pressed={value !== null}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={optionClass(value !== null)}
        >
          Selected
        </button>
      </div>
      {selected && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex min-h-[44px] w-full items-center justify-between rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-sm text-ink hover:border-accent/40"
        >
          <span>{selected.name}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            Change <ChevronRight size={14} />
          </span>
        </button>
      )}
      <ClassTypeSheet
        open={open}
        classTypes={classTypes}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
      />
    </div>
  );
}

function ClassTypeSheet({
  open,
  classTypes,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  classTypes: ClassTypeOption[];
  value: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open && mounted);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-type-sheet-title"
        tabIndex={-1}
        className="w-full max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-card px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-modal outline-none sm:max-w-md sm:rounded-2xl sm:p-8 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="class-type-sheet-title" className="text-lg font-bold text-ink">
            Choose a class type
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-warm hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        {classTypes.length === 0 ? (
          <p className="text-sm text-muted">No class types to choose from yet.</p>
        ) : (
          <ul className="space-y-2">
            {classTypes.map((c) => {
              const on = c.id === value;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onPick(c.id)}
                    className={`flex min-h-[48px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                      on
                        ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
                        : "border-ink/10 bg-card text-ink hover:border-accent/40"
                    }`}
                  >
                    {c.name}
                    {on && <Check size={16} className="text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
