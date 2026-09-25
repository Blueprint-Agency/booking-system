"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * The app's one dropdown. A native `<select>` hands its list to the browser,
 * which draws it in the OS's own type and colours — oversized, grey and blue,
 * nothing like the page around it. This draws the list itself, as a card in
 * the same language as the rest of the member app.
 *
 * The combobox pattern: focus stays on the trigger, and the highlighted option
 * is `aria-activedescendant`. Arrow keys, Home/End, Enter/Space, Escape and
 * type-to-jump work as they do on a native select. A `<label htmlFor={id}>`
 * names it.
 *
 * To make "nothing chosen" selectable (All locations, Not set), pass it as an
 * option with value `""`. `placeholder` is only what the trigger shows when
 * the value matches no option.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  disabled,
  className,
  triggerClassName,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** For a select with no visible `<label>`. */
  ariaLabel?: string;
  disabled?: boolean;
  /** On the wrapper — width and layout. */
  className?: string;
  /** On the trigger — its border, padding and type, to match the fields beside it. */
  triggerClassName?: string;
}) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [upward, setUpward] = useState(false);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openList = useCallback(() => {
    if (disabled || options.length === 0) return;
    // Open upward when the list would run off the bottom of the viewport and
    // there is more room above — a time picker near the foot of a sheet.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setUpward(below < 280 && rect.top > below);
    }
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    setOpen(false);
  };

  // Close on a press anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted option in view as the keyboard moves through a long list.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpTo = (key: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const q = t.text.toLowerCase();
    const from = open ? active : selectedIndex;
    // Search after the current option first, so pressing "T" twice moves on.
    const order = options.map((_, i) => (from + 1 + i) % options.length);
    const hit = order.find((i) => options[i]!.label.toLowerCase().startsWith(q));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else if (options[hit]!.value !== value) onChange(options[hit]!.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        jumpTo(e.key);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) jumpTo(e.key);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={baseId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full min-h-[44px] items-center gap-2 rounded-xl border border-ink/10 bg-card px-3.5 text-left text-sm text-ink transition-colors",
          "focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          open && "border-accent",
          triggerClassName,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={baseId}
          tabIndex={-1}
          className={cn(
            "absolute left-0 z-50 max-h-72 min-w-full w-max max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain",
            "rounded-xl border border-ink/5 bg-card p-1 shadow-modal animate-drop-in",
            upward ? "bottom-full mb-1.5 origin-bottom" : "top-full mt-1.5 origin-top",
          )}
        >
          {options.map((o, i) => {
            const isSelected = i === selectedIndex;
            return (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                // Keep focus on the trigger, where the keyboard handling lives.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink",
                  i === active && "bg-ink/[0.05]",
                  isSelected && "font-semibold",
                )}
              >
                <span className="min-w-0 flex-1">{o.label}</span>
                <Check
                  size={15}
                  aria-hidden
                  className={cn("shrink-0 text-accent", !isSelected && "invisible")}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
