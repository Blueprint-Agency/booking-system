"use client";

import { useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useApi } from "@/lib/api";
import type { DisplayPrefs, FontSize, Theme } from "@/lib/display-prefs";
import { pickDisplayPrefs, useDisplayPrefs } from "@/lib/use-display-prefs";
import { cn } from "@/lib/utils";

const cardClass = "rounded-2xl bg-card border border-ink/5 shadow-soft p-5 sm:p-6 space-y-5";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

// Each option's "Aa" is a step larger than the last, in px so the three keep
// their difference whichever size is in force.
const FONT_SIZE_OPTIONS: { value: FontSize; label: string; sample: string }[] = [
  { value: "small", label: "Small", sample: "text-[13px]" },
  { value: "medium", label: "Medium", sample: "text-[15px]" },
  { value: "large", label: "Large", sample: "text-[17px]" },
];

/**
 * A row of radio buttons drawn as a segmented control: the same track and
 * raised selection as `SegmentedTabs`, but a real radio group, so arrow keys
 * move between the options and a screen reader hears one choice of several.
 */
function SegmentedRadio<T extends string>({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; content: React.ReactNode }[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink mb-1.5">{legend}</legend>
      <div className="flex w-full sm:w-max rounded-full bg-ink/5 p-1">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex flex-1 sm:flex-none sm:min-w-[7rem] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 min-h-[40px] text-sm font-semibold transition-colors",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
                selected ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.content}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * How the app looks: light or dark, and the text size. A pick applies at once
 * on this device and is saved to the member's account, so the next device they
 * sign in on follows it (`lib/display-prefs.ts`). There is no Save button: a
 * save that fails leaves the change on this device and says so.
 */
export function GeneralSettingsCard() {
  const api = useApi();
  const prefs = useDisplayPrefs();
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  // Only the latest pick's reply may set the status line.
  const latest = useRef(0);

  async function choose(change: Partial<DisplayPrefs>) {
    const call = ++latest.current;
    const saved = await pickDisplayPrefs(api, change);
    if (call === latest.current) setStatus(saved ? "saved" : "failed");
  }

  return (
    <section className={cardClass} aria-labelledby="display-heading">
      <div>
        <h2 id="display-heading" className="text-base font-bold text-ink">
          Display
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Saved to your account, so every device you sign in on follows it.
        </p>
      </div>

      <SegmentedRadio
        name="theme"
        legend="Theme"
        value={prefs.theme}
        onChange={(theme) => choose({ theme })}
        options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
          value,
          content: (
            <>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </>
          ),
        }))}
      />

      <SegmentedRadio
        name="font-size"
        legend="Text size"
        value={prefs.fontSize}
        onChange={(fontSize) => choose({ fontSize })}
        options={FONT_SIZE_OPTIONS.map(({ value, label, sample }) => ({
          value,
          content: (
            <>
              <span aria-hidden className={cn("font-bold leading-none", sample)}>
                Aa
              </span>
              {label}
            </>
          ),
        }))}
      />

      <p role="status" className="text-sm font-medium empty:hidden">
        {status === "saved" ? (
          <span className="text-sage">Saved to your account</span>
        ) : status === "failed" ? (
          <span className="text-error">
            Couldn&apos;t save to your account. It still applies on this device.
          </span>
        ) : null}
      </p>
    </section>
  );
}
