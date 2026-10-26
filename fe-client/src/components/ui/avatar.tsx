"use client";

import { useState } from "react";
import { avatarFace } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * A person in a circle: their Profile picture, or their initials when they have
 * none or the picture's file will not load. Size and colours come from
 * `className`; the initials inherit its text size.
 */
export function Avatar({
  name,
  email,
  photoUrl,
  className,
}: {
  name: string;
  email?: string;
  photoUrl?: string | null;
  className?: string;
}) {
  const face = avatarFace({ name, email, photoUrl });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = face.kind === "photo" && failedSrc !== face.src;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold select-none",
        className,
      )}
      aria-hidden
    >
      {showPhoto ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={face.src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(face.src)}
        />
      ) : (
        face.initials
      )}
    </span>
  );
}
