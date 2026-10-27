"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A person's Profile picture, or their initials when they have none or it fails to load. */
export function Avatar({
  name,
  src,
  size = 32,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const picture = src && src !== failed ? src : null;
  const style = picture
    ? undefined
    : { background: `hsl(${hashHue(name)}, 35%, 80%)`, color: "#0d1a3e" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
        className
      )}
      style={{ width: size, height: size, ...style }}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(picture)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
