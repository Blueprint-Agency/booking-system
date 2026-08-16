"use client";

/** THROWAWAY — prototype only. Hidden in production builds. Delete with the prototype route. */

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next.key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full bg-black text-white shadow-2xl px-2 py-1.5 text-xs font-mono">
      <button onClick={() => go(-1)} aria-label="Previous variant" className="p-1.5 rounded-full hover:bg-white/15">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-3 whitespace-nowrap">
        {variants[index].key} — {variants[index].name}
      </span>
      <button onClick={() => go(1)} aria-label="Next variant" className="p-1.5 rounded-full hover:bg-white/15">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
