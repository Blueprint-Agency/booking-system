"use client";

import Image from "next/image";
import Link from "next/link";
import { img } from "@/data/images";
import { useBrand } from "@/components/brand/brand-provider";

type AuthSplitShellProps = {
  imageKey: string;
  quote?: string;
  children: React.ReactNode;
};

export function AuthSplitShell({
  imageKey,
  quote,
  children,
}: AuthSplitShellProps) {
  const brand = useBrand();
  const image = img(imageKey);
  // The studio's own photography when it has supplied any; the neutral stock
  // image otherwise. Never another studio's premises.
  const src = brand.ogImageUrl ?? image.unsplash;
  const alt = brand.ogImageUrl ? brand.name : image.alt;

  return (
    // 4rem is the top bar. `dvh` so mobile browser chrome collapsing doesn't
    // leave a stray scroll on an otherwise short form.
    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100dvh-4rem)]">
      <div className="relative hidden lg:block">
        <Image
          src={src}
          alt={alt}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 0vw"
          className="object-cover photo-warm"
        />
        <div className="absolute inset-0 bg-ink/30" />
        <div className="absolute inset-0 flex flex-col justify-between p-12 text-paper">
          <Link href="/" className="text-lg font-bold tracking-tight">
            {brand.name}
          </Link>
          {quote ? (
            <blockquote className="max-w-md text-2xl font-serif leading-snug">
              &ldquo;{quote}&rdquo;
            </blockquote>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-center bg-paper px-6 py-12 md:px-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
